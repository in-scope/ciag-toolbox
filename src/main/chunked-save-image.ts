import { randomUUID } from "node:crypto";
import { open, unlink, type FileHandle } from "node:fs/promises";

import {
  rethrowDescribingDiskFullFailure,
  writeExactLengthAtOffset,
} from "./chunked-save-bundle";
import {
  createStreamingPng16GrayscaleEncoder,
  rawPng16SampleByteLengthForDimensions,
  type StreamingPng16GrayscaleEncoder,
} from "./png16-encode";
import { join } from "node:path";

import {
  saveImageFolderFilePartName,
  type SaveImageFolderFileDescriptor,
  type SaveImagePart,
  type SaveImagePartEncoding,
} from "../shared/chunked-save-image-protocol";

// CT-237: electron-free session bookkeeping for the chunked save-image
// protocol (see src/shared/chunked-save-image-protocol.ts for why the old
// whole-payload invoke died at gigabyte scale). Chunks are written STRAIGHT to
// the destination paths the save dialog chose, so the encoded export is never
// resident in main; finish keeps the files only when every described byte
// arrived, and release deletes the partials so a failed or abandoned export
// never leaves an invalid file behind. The IPC layer (save-image-dialog.ts)
// owns the save dialog; this module owns only the transfer state.
//
// CT-271: a part may carry an ENCODING descriptor, in which case its chunks
// are RAW payload bytes (the described byteLength counts those), and the
// session encodes them on the way to disk (16-bit PNG via png16-encode.ts).
//
// CT-273: a folder export (PNG stack) opens one writable part per band file
// inside the chosen folder; the same finish/release semantics cover every
// file, so a failed export never leaves a partial stack behind.

export interface SaveImagePartTarget {
  readonly filePath: string;
  readonly byteLength: number;
  readonly encoding?: SaveImagePartEncoding;
}

export interface SaveImageWriteRequest {
  readonly primary: SaveImagePartTarget;
  readonly sidecar?: SaveImagePartTarget;
}

export interface SaveImageSessionStore {
  begin(request: SaveImageWriteRequest): Promise<string>;
  // CT-273: a folder export writes every described file into folderPath; finish
  // reports the folder, and release deletes every partial file.
  beginFilesInFolder(
    folderPath: string,
    files: ReadonlyArray<SaveImageFolderFileDescriptor>,
  ): Promise<string>;
  appendChunk(token: string, part: SaveImagePart, bytes: Uint8Array): Promise<void>;
  finishKeepingWrittenFiles(token: string): Promise<string>;
  releaseDeletingPartialFiles(token: string): Promise<void>;
}

const NOT_ENOUGH_DISK_SPACE_MESSAGE =
  "There is not enough disk space to save this image. Free up space and try again.";

interface WritablePart {
  readonly target: SaveImagePartTarget;
  handle: FileHandle | null;
  receivedBytes: number;
  writtenFileBytes: number;
  encoder: StreamingPng16GrayscaleEncoder | null;
}

interface SaveImageSession {
  readonly partsByName: Map<SaveImagePart, WritablePart>;
  // The path finish reports back: the primary file for a single-file save,
  // the destination folder for a CT-273 folder export.
  readonly reportedPathOnFinish: string;
}

interface NamedPartTarget {
  readonly part: SaveImagePart;
  readonly target: SaveImagePartTarget;
}

export function createSaveImageSessionStore(): SaveImageSessionStore {
  const sessions = new Map<string, SaveImageSession>();
  return {
    begin: (request) =>
      beginSessionOpeningDestinationFiles(
        sessions,
        listNamedTargetsForSingleFileSave(request),
        request.primary.filePath,
      ),
    beginFilesInFolder: async (folderPath, files) =>
      beginSessionOpeningDestinationFiles(
        sessions,
        listNamedTargetsForFolderExport(folderPath, files),
        folderPath,
      ),
    appendChunk: async (token, part, bytes) =>
      appendChunkToDestinationFile(requireSession(sessions, token), part, bytes),
    finishKeepingWrittenFiles: (token) => finishSessionKeepingFiles(sessions, token),
    releaseDeletingPartialFiles: (token) => releaseSessionDeletingFiles(sessions, token),
  };
}

function listNamedTargetsForSingleFileSave(
  request: SaveImageWriteRequest,
): ReadonlyArray<NamedPartTarget> {
  const targets: NamedPartTarget[] = [{ part: "primary", target: request.primary }];
  if (request.sidecar) targets.push({ part: "sidecar", target: request.sidecar });
  return targets;
}

function listNamedTargetsForFolderExport(
  folderPath: string,
  files: ReadonlyArray<SaveImageFolderFileDescriptor>,
): ReadonlyArray<NamedPartTarget> {
  if (files.length === 0) throw new Error("The folder export described no files.");
  return files.map((file, index) => ({
    part: saveImageFolderFilePartName(index),
    target: {
      filePath: join(folderPath, assertPlainExportFileName(file.fileName)),
      byteLength: file.byteLength,
      ...(file.encoding ? { encoding: file.encoding } : {}),
    },
  }));
}

// File names come from the renderer's sanitizer; refuse anything that could
// escape the chosen folder regardless.
function assertPlainExportFileName(fileName: string): string {
  if (fileName.length === 0 || /[\\/]/.test(fileName) || fileName.includes("..")) {
    throw new Error("The folder export described an invalid file name.");
  }
  return fileName;
}

async function beginSessionOpeningDestinationFiles(
  sessions: Map<string, SaveImageSession>,
  namedTargets: ReadonlyArray<NamedPartTarget>,
  reportedPathOnFinish: string,
): Promise<string> {
  const token = randomUUID();
  const partsByName = new Map<SaveImagePart, WritablePart>();
  sessions.set(token, { partsByName, reportedPathOnFinish });
  await openDestinationFilesOrReleaseSession(sessions, token, partsByName, namedTargets);
  return token;
}

async function openDestinationFilesOrReleaseSession(
  sessions: Map<string, SaveImageSession>,
  token: string,
  partsByName: Map<SaveImagePart, WritablePart>,
  namedTargets: ReadonlyArray<NamedPartTarget>,
): Promise<void> {
  try {
    for (const named of namedTargets) {
      partsByName.set(named.part, await openOneDestinationFile(assertValidPartTarget(named.target)));
    }
  } catch (error) {
    await releaseSessionDeletingFiles(sessions, token);
    throw error;
  }
}

function assertValidPartTarget(target: SaveImagePartTarget): SaveImagePartTarget {
  if (!Number.isInteger(target.byteLength) || target.byteLength <= 0) {
    throw new Error("The export described an invalid encoded size.");
  }
  assertEncodingMatchesDescribedRawByteLength(target);
  return target;
}

// An encoded part's byteLength describes the RAW payload the encoder expects,
// so the two descriptions must agree before any file is opened.
function assertEncodingMatchesDescribedRawByteLength(target: SaveImagePartTarget): void {
  if (!target.encoding) return;
  if (target.byteLength !== rawPng16SampleByteLengthForDimensions(target.encoding)) {
    throw new Error("The export described an invalid encoded size.");
  }
}

async function openOneDestinationFile(target: SaveImagePartTarget): Promise<WritablePart> {
  const part: WritablePart = {
    target,
    handle: await open(target.filePath, "w"),
    receivedBytes: 0,
    writtenFileBytes: 0,
    encoder: null,
  };
  part.encoder = createPartEncoderOrNull(part);
  return part;
}

function createPartEncoderOrNull(part: WritablePart): StreamingPng16GrayscaleEncoder | null {
  if (!part.target.encoding) return null;
  return createStreamingPng16GrayscaleEncoder(part.target.encoding, (bytes) =>
    writeBytesToPartFileAtCurrentEnd(part, bytes),
  );
}

async function writeBytesToPartFileAtCurrentEnd(
  part: WritablePart,
  bytes: Uint8Array,
): Promise<void> {
  await writeExactLengthAtOffset(part.handle!, bytes, part.writtenFileBytes).catch(
    (error) => rethrowDescribingDiskFullFailure(error, NOT_ENOUGH_DISK_SPACE_MESSAGE),
  );
  part.writtenFileBytes += bytes.byteLength;
}

function requireSession(
  sessions: Map<string, SaveImageSession>,
  token: string,
): SaveImageSession {
  const session = sessions.get(token);
  if (session === undefined) throw new Error("Unknown image save token");
  return session;
}

async function appendChunkToDestinationFile(
  session: SaveImageSession,
  part: SaveImagePart,
  bytes: Uint8Array,
): Promise<void> {
  const writable = requireWritablePart(session, part);
  if (bytes.byteLength === 0 || writable.receivedBytes + bytes.byteLength > writable.target.byteLength) {
    throw new Error("The exported image bytes did not match the described size.");
  }
  await deliverChunkToPartDestination(writable, bytes);
  writable.receivedBytes += bytes.byteLength;
}

async function deliverChunkToPartDestination(
  writable: WritablePart,
  bytes: Uint8Array,
): Promise<void> {
  if (writable.encoder) {
    await writable.encoder.consumeRawBigEndianSampleBytes(bytes);
    return;
  }
  await writeBytesToPartFileAtCurrentEnd(writable, bytes);
}

function requireWritablePart(session: SaveImageSession, part: SaveImagePart): WritablePart {
  const writable = session.partsByName.get(part);
  if (writable === undefined || writable.handle === null) {
    throw new Error("The image save received bytes for an unknown file.");
  }
  return writable;
}

async function finishSessionKeepingFiles(
  sessions: Map<string, SaveImageSession>,
  token: string,
): Promise<string> {
  const session = requireSession(sessions, token);
  assertEveryPartFullyReceived(session);
  await finishEncodersWritingTrailers(session);
  await closeAllDestinationHandles(session);
  sessions.delete(token);
  return session.reportedPathOnFinish;
}

async function finishEncodersWritingTrailers(session: SaveImageSession): Promise<void> {
  for (const writable of session.partsByName.values()) {
    if (writable.encoder) await writable.encoder.finishWritingPngTrailer();
  }
}

function assertEveryPartFullyReceived(session: SaveImageSession): void {
  for (const writable of session.partsByName.values()) {
    if (writable.receivedBytes !== writable.target.byteLength) {
      throw new Error("The exported image bytes did not match the described size.");
    }
  }
}

async function closeAllDestinationHandles(session: SaveImageSession): Promise<void> {
  for (const writable of session.partsByName.values()) {
    writable.encoder?.disposeAbandoningEncode();
    writable.encoder = null;
    await writable.handle?.close().catch(() => undefined);
    writable.handle = null;
  }
}

async function releaseSessionDeletingFiles(
  sessions: Map<string, SaveImageSession>,
  token: string,
): Promise<void> {
  const session = sessions.get(token);
  if (session === undefined) return;
  sessions.delete(token);
  await closeAllDestinationHandles(session);
  for (const writable of session.partsByName.values()) {
    await unlink(writable.target.filePath).catch(() => undefined);
  }
}
