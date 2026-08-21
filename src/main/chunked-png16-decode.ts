import { randomUUID } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";

import { createStreamingPng16Decoder, type StreamingPng16Decoder } from "./png16-decode";
import { assertFilePathWithinOpenableSizeLimitOrThrow } from "./openable-file-size-limit";
import {
  PNG16_DECODED_CHUNK_BYTES,
  totalDecodedPng16ByteLength,
  type ChunkedPng16DecodeBeginResult,
  type ChunkedPng16DecodeChunkResult,
} from "../shared/chunked-png16-decode-protocol";

// CT-272: the session store behind the chunked 16-bit PNG decode protocol.
// Main re-reads the picked file from disk in small slices, pumps them through
// the streaming decoder, and serves the DECODED big-endian samples to the
// renderer in bounded chunks; feeding pauses whenever enough decoded output
// is pending, so neither the file nor its (larger) decoded payload ever
// exists whole in this process. Electron-free per the main testability
// pattern; chunked-png16-decode-ipc.ts wires the channels.

const FILE_READ_SLICE_BYTES = 4 * 1024 * 1024;

export interface ChunkedPng16DecodeSessions {
  begin(filePath: string): Promise<ChunkedPng16DecodeBeginResult>;
  readNextDecodedChunk(token: string): Promise<ChunkedPng16DecodeChunkResult>;
  finish(token: string): Promise<void>;
  abort(token: string): Promise<void>;
}

interface Png16DecodeSession {
  readonly handle: FileHandle;
  readonly fileSizeBytes: number;
  fileOffsetBytes: number;
  readonly decoder: StreamingPng16Decoder;
  readonly pendingDecodedPieces: Uint8Array[];
  pendingDecodedByteLength: number;
  totalDecodedByteLength: number;
  servedDecodedByteLength: number;
  decoderFinished: boolean;
}

export function createChunkedPng16DecodeSessions(
  fileReadSliceBytes: number = FILE_READ_SLICE_BYTES,
  decodedChunkBytes: number = PNG16_DECODED_CHUNK_BYTES,
): ChunkedPng16DecodeSessions {
  const sessions = new Map<string, Png16DecodeSession>();
  return {
    begin: (filePath) => beginSession(sessions, filePath, fileReadSliceBytes),
    readNextDecodedChunk: (token) =>
      readNextDecodedChunkOfSession(sessions, token, fileReadSliceBytes, decodedChunkBytes),
    finish: (token) => finishSessionAssertingFullyServed(sessions, token),
    abort: (token) => abortSessionDiscardingProgress(sessions, token),
  };
}

async function beginSession(
  sessions: Map<string, Png16DecodeSession>,
  filePath: string,
  fileReadSliceBytes: number,
): Promise<ChunkedPng16DecodeBeginResult> {
  await assertFilePathWithinOpenableSizeLimitOrThrow(filePath);
  const session = await openSessionForFile(filePath);
  try {
    return await registerSessionOncePngHeaderIsParsed(sessions, session, fileReadSliceBytes);
  } catch (error) {
    await disposeSessionResources(session);
    throw error;
  }
}

async function openSessionForFile(filePath: string): Promise<Png16DecodeSession> {
  const handle = await open(filePath, "r");
  const stats = await handle.stat();
  return {
    handle,
    fileSizeBytes: stats.size,
    fileOffsetBytes: 0,
    decoder: createStreamingPng16Decoder(),
    pendingDecodedPieces: [],
    pendingDecodedByteLength: 0,
    totalDecodedByteLength: 0,
    servedDecodedByteLength: 0,
    decoderFinished: false,
  };
}

async function registerSessionOncePngHeaderIsParsed(
  sessions: Map<string, Png16DecodeSession>,
  session: Png16DecodeSession,
  fileReadSliceBytes: number,
): Promise<ChunkedPng16DecodeBeginResult> {
  const header = await pumpFileIntoDecoderUntilHeaderParsed(session, fileReadSliceBytes);
  session.totalDecodedByteLength = totalDecodedPng16ByteLength(header);
  const token = randomUUID();
  sessions.set(token, session);
  return { token, ...header };
}

async function pumpFileIntoDecoderUntilHeaderParsed(
  session: Png16DecodeSession,
  fileReadSliceBytes: number,
): Promise<{ width: number; height: number; channelCount: number }> {
  while (session.decoder.headerOrNull() === null) {
    if (session.fileOffsetBytes >= session.fileSizeBytes) {
      throw new Error("The PNG file ended before its header could be read");
    }
    await feedNextFileSliceIntoDecoder(session, fileReadSliceBytes);
  }
  return session.decoder.headerOrNull()!;
}

async function feedNextFileSliceIntoDecoder(
  session: Png16DecodeSession,
  fileReadSliceBytes: number,
): Promise<void> {
  const length = Math.min(fileReadSliceBytes, session.fileSizeBytes - session.fileOffsetBytes);
  const bytes = await readExactLengthAtOffset(session.handle, session.fileOffsetBytes, length);
  session.fileOffsetBytes += length;
  await session.decoder.consumeFileBytes(bytes);
  collectDecodedPiecesFromDecoder(session);
}

function collectDecodedPiecesFromDecoder(session: Png16DecodeSession): void {
  for (const piece of session.decoder.takePendingDecodedBytes()) {
    session.pendingDecodedPieces.push(piece);
    session.pendingDecodedByteLength += piece.byteLength;
  }
}

async function readNextDecodedChunkOfSession(
  sessions: Map<string, Png16DecodeSession>,
  token: string,
  fileReadSliceBytes: number,
  decodedChunkBytes: number,
): Promise<ChunkedPng16DecodeChunkResult> {
  const session = requireSession(sessions, token);
  await pumpUntilChunkIsServableOrDecodeCompletes(session, fileReadSliceBytes, decodedChunkBytes);
  const bytes = takeBytesFromPieceQueue(session, decodedChunkBytes);
  session.servedDecodedByteLength += bytes.byteLength;
  return { done: session.servedDecodedByteLength >= session.totalDecodedByteLength, bytes };
}

async function pumpUntilChunkIsServableOrDecodeCompletes(
  session: Png16DecodeSession,
  fileReadSliceBytes: number,
  decodedChunkBytes: number,
): Promise<void> {
  while (
    session.pendingDecodedByteLength < decodedChunkBytes &&
    session.fileOffsetBytes < session.fileSizeBytes
  ) {
    await feedNextFileSliceIntoDecoder(session, fileReadSliceBytes);
  }
  await finishDecoderOnceFileIsFullyFed(session);
}

async function finishDecoderOnceFileIsFullyFed(session: Png16DecodeSession): Promise<void> {
  if (session.decoderFinished || session.fileOffsetBytes < session.fileSizeBytes) return;
  session.decoderFinished = true;
  await session.decoder.finishAssertingEveryRowDecoded();
  collectDecodedPiecesFromDecoder(session);
}

function takeBytesFromPieceQueue(session: Png16DecodeSession, maxBytes: number): Uint8Array {
  const taken = new Uint8Array(Math.min(maxBytes, session.pendingDecodedByteLength));
  let written = 0;
  while (written < taken.byteLength) {
    written += moveFrontPieceBytesInto(session, taken, written);
  }
  session.pendingDecodedByteLength -= taken.byteLength;
  return taken;
}

function moveFrontPieceBytesInto(
  session: Png16DecodeSession,
  destination: Uint8Array,
  writtenSoFar: number,
): number {
  const piece = session.pendingDecodedPieces[0]!;
  const take = Math.min(piece.byteLength, destination.byteLength - writtenSoFar);
  destination.set(piece.subarray(0, take), writtenSoFar);
  if (take === piece.byteLength) session.pendingDecodedPieces.shift();
  else session.pendingDecodedPieces[0] = piece.subarray(take);
  return take;
}

async function readExactLengthAtOffset(
  handle: FileHandle,
  offsetBytes: number,
  length: number,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(bytes, filled, length - filled, offsetBytes + filled);
    if (bytesRead === 0) throw new Error("Unexpected end of file during a chunked PNG decode");
    filled += bytesRead;
  }
  return bytes;
}

function requireSession(
  sessions: Map<string, Png16DecodeSession>,
  token: string,
): Png16DecodeSession {
  const session = sessions.get(token);
  if (session === undefined) throw new Error("Unknown chunked PNG decode token");
  return session;
}

async function finishSessionAssertingFullyServed(
  sessions: Map<string, Png16DecodeSession>,
  token: string,
): Promise<void> {
  const session = requireSession(sessions, token);
  sessions.delete(token);
  const fullyServed = session.servedDecodedByteLength >= session.totalDecodedByteLength;
  await disposeSessionResources(session);
  if (!fullyServed) {
    throw new Error("Chunked PNG decode finished before every decoded byte was read");
  }
}

async function abortSessionDiscardingProgress(
  sessions: Map<string, Png16DecodeSession>,
  token: string,
): Promise<void> {
  const session = sessions.get(token);
  if (session === undefined) return;
  sessions.delete(token);
  await disposeSessionResources(session);
}

async function disposeSessionResources(session: Png16DecodeSession): Promise<void> {
  session.decoder.disposeAbandoningDecode();
  await session.handle.close().catch(() => undefined);
}
