import { createHash, randomUUID, type Hash } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import { basename } from "node:path";

import {
  findEnviBinarySiblingPathOrNull,
  isEnviHeaderFilePath,
} from "./envi-binary-sibling";
import { assertFilePathWithinOpenableSizeLimitOrThrow } from "./openable-file-size-limit";
import {
  OPENED_IMAGE_READ_CHUNK_BYTES,
  type ChunkedOpenedImageReadBeginResult,
  type ChunkedOpenedImageReadChunkResult,
  type ChunkedOpenedImageReadFinishResult,
  type ChunkedOpenedImageReadTarget,
} from "../shared/chunked-opened-image-read-protocol";

// CT-219b: streams an opened image file (and its ENVI binary sibling, when the
// picked file is a .hdr header) to the renderer in small sequential chunks,
// hashing the main file incrementally, so no single IPC reply ever carries the
// whole file. See src/shared/chunked-opened-image-read-protocol.ts for why a
// whole-file reply kills the main process at gigabyte scale.

interface ChunkedReadTargetState {
  readonly handle: FileHandle;
  readonly sizeBytes: number;
  offsetBytes: number;
  readonly hash: Hash | null;
}

interface ChunkedReadSession {
  readonly file: ChunkedReadTargetState;
  readonly sidecar: ChunkedReadTargetState | null;
}

export interface ChunkedOpenedImageFileReader {
  begin(filePath: string): Promise<ChunkedOpenedImageReadBeginResult>;
  readNextChunk(
    token: string,
    target: ChunkedOpenedImageReadTarget,
  ): Promise<ChunkedOpenedImageReadChunkResult>;
  finish(token: string): Promise<ChunkedOpenedImageReadFinishResult>;
  abort(token: string): Promise<void>;
}

export function createChunkedOpenedImageFileReader(
  chunkBytes: number = OPENED_IMAGE_READ_CHUNK_BYTES,
): ChunkedOpenedImageFileReader {
  const sessions = new Map<string, ChunkedReadSession>();
  return {
    begin: (filePath) => beginSession(sessions, filePath),
    readNextChunk: (token, target) => readNextChunkOfSession(sessions, token, target, chunkBytes),
    finish: (token) => finishSessionAndDigestHash(sessions, token),
    abort: (token) => abortSessionDiscardingProgress(sessions, token),
  };
}

async function beginSession(
  sessions: Map<string, ChunkedReadSession>,
  filePath: string,
): Promise<ChunkedOpenedImageReadBeginResult> {
  await assertFilePathWithinOpenableSizeLimitOrThrow(filePath);
  const sidecarPath = await findRequiredEnviSidecarPathOrNull(filePath);
  if (sidecarPath !== null) await assertFilePathWithinOpenableSizeLimitOrThrow(sidecarPath);
  const session = await openSessionTargets(filePath, sidecarPath);
  const token = randomUUID();
  sessions.set(token, session);
  return describeBegunSession(token, session, sidecarPath);
}

async function findRequiredEnviSidecarPathOrNull(filePath: string): Promise<string | null> {
  if (!isEnviHeaderFilePath(filePath)) return null;
  const sidecarPath = await findEnviBinarySiblingPathOrNull(filePath);
  if (sidecarPath === null) {
    throw new Error(
      `Could not find ENVI binary sibling for ${basename(filePath)} (looked for .bin/.dat/.img/.raw or extensionless match)`,
    );
  }
  return sidecarPath;
}

async function openSessionTargets(
  filePath: string,
  sidecarPath: string | null,
): Promise<ChunkedReadSession> {
  const file = await openTargetStateForReading(filePath, createHash("sha256"));
  if (sidecarPath === null) return { file, sidecar: null };
  try {
    return { file, sidecar: await openTargetStateForReading(sidecarPath, null) };
  } catch (error) {
    await file.handle.close().catch(() => undefined);
    throw error;
  }
}

async function openTargetStateForReading(
  filePath: string,
  hash: Hash | null,
): Promise<ChunkedReadTargetState> {
  const handle = await open(filePath, "r");
  const stats = await handle.stat();
  return { handle, sizeBytes: stats.size, offsetBytes: 0, hash };
}

function describeBegunSession(
  token: string,
  session: ChunkedReadSession,
  sidecarPath: string | null,
): ChunkedOpenedImageReadBeginResult {
  return {
    token,
    fileSizeBytes: session.file.sizeBytes,
    sidecar:
      session.sidecar !== null && sidecarPath !== null
        ? { fileName: basename(sidecarPath), sizeBytes: session.sidecar.sizeBytes }
        : null,
  };
}

async function readNextChunkOfSession(
  sessions: Map<string, ChunkedReadSession>,
  token: string,
  target: ChunkedOpenedImageReadTarget,
  chunkBytes: number,
): Promise<ChunkedOpenedImageReadChunkResult> {
  const state = requireTargetState(sessions, token, target);
  const length = Math.min(chunkBytes, state.sizeBytes - state.offsetBytes);
  const bytes = await readExactLengthAtOffset(state.handle, state.offsetBytes, length);
  state.hash?.update(bytes);
  state.offsetBytes += length;
  return { done: state.offsetBytes >= state.sizeBytes, bytes };
}

function requireSession(
  sessions: Map<string, ChunkedReadSession>,
  token: string,
): ChunkedReadSession {
  const session = sessions.get(token);
  if (session === undefined) throw new Error("Unknown chunked file read token");
  return session;
}

function requireTargetState(
  sessions: Map<string, ChunkedReadSession>,
  token: string,
  target: ChunkedOpenedImageReadTarget,
): ChunkedReadTargetState {
  const session = requireSession(sessions, token);
  if (target === "file") return session.file;
  if (session.sidecar === null) throw new Error("This chunked file read has no sidecar");
  return session.sidecar;
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
    if (bytesRead === 0) throw new Error("Unexpected end of file during a chunked file read");
    filled += bytesRead;
  }
  return bytes;
}

async function finishSessionAndDigestHash(
  sessions: Map<string, ChunkedReadSession>,
  token: string,
): Promise<ChunkedOpenedImageReadFinishResult> {
  const session = requireSession(sessions, token);
  assertEveryTargetFullyRead(session);
  const contentHash = session.file.hash!.digest("hex");
  sessions.delete(token);
  await closeEverySessionHandle(session);
  return { contentHash };
}

function assertEveryTargetFullyRead(session: ChunkedReadSession): void {
  const fileFullyRead = session.file.offsetBytes >= session.file.sizeBytes;
  const sidecarFullyRead =
    session.sidecar === null || session.sidecar.offsetBytes >= session.sidecar.sizeBytes;
  if (!fileFullyRead || !sidecarFullyRead) {
    throw new Error("Chunked file read finished before every byte was read");
  }
}

async function abortSessionDiscardingProgress(
  sessions: Map<string, ChunkedReadSession>,
  token: string,
): Promise<void> {
  const session = sessions.get(token);
  if (session === undefined) return;
  sessions.delete(token);
  await closeEverySessionHandle(session);
}

async function closeEverySessionHandle(session: ChunkedReadSession): Promise<void> {
  await session.file.handle.close().catch(() => undefined);
  await session.sidecar?.handle.close().catch(() => undefined);
}
