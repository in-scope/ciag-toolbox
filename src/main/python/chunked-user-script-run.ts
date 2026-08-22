import { randomUUID } from "node:crypto";
import { open, unlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EncodedCubePayload } from "./cube-payload";
import type { UserScriptInput } from "./worker-protocol";
import {
  USER_SCRIPT_RUN_CHUNK_BYTES,
  type UserScriptRunCubeDescriptor,
  type UserScriptRunResultChunkResult,
  type UserScriptRunResultKind,
} from "../../shared/chunked-user-script-run-protocol";

// CT-219g: electron-free session bookkeeping for the chunked user-script run
// protocol (see src/shared/chunked-user-script-run-protocol.ts for why the old
// whole-cube invoke wedged the renderer at gigabyte scale). The uploaded cube
// bytes SPOOL TO A TEMP FILE and stream to the worker's stdin from disk, so the
// main process never holds the uploaded cube in memory at all: at reference
// scale the upload (~3 GB) plus the equally large in-memory result bands plus
// the worker's own footprint drove main into a fatal
// v8::ArrayBuffer::NewBackingStore out-of-memory (observed 2026-07-10). The IPC
// layer (user-script-ipc.ts) owns dialogs, interpreter resolution, and the
// worker subprocess; this module owns only the transfer state.

export interface BeginChunkedUserScriptRunRequest {
  readonly cube: UserScriptRunCubeDescriptor;
  readonly resultKind: UserScriptRunResultKind;
  readonly input: UserScriptInput;
  readonly releaseInputResources: () => Promise<void>;
  readonly sourceName: string | null;
  readonly interpreterPath: string;
  readonly sandbox: boolean;
}

export interface ExecutableUserScriptRun {
  readonly input: UserScriptInput;
  readonly cube: EncodedCubePayload;
  readonly resultKind: UserScriptRunResultKind;
  readonly sourceName: string | null;
  readonly interpreterPath: string;
  readonly sandbox: boolean;
  // Where the worker harness spools a cube result's raw bytes; pull chunks are
  // read back from this file so the result never materializes in main either.
  readonly cubeResultSpoolPath: string;
}

export interface StoredCubeResultSummary {
  readonly totalBytes: number;
}

export interface ChunkedUserScriptRunSessionStore {
  begin(request: BeginChunkedUserScriptRunRequest): Promise<string>;
  appendCubeChunk(token: string, bytes: Uint8Array): Promise<void>;
  takeExecutableRun(token: string): ExecutableUserScriptRun;
  releaseInputResourcesAfterRun(token: string): Promise<void>;
  storeCubeResultForPull(
    token: string,
    shape: [number, number, number],
    totalBytes: number,
  ): StoredCubeResultSummary;
  readNextResultChunk(token: string): Promise<UserScriptRunResultChunkResult>;
  release(token: string): Promise<void>;
  // CT-268: the execute handler registers the running worker's kill while the
  // subprocess is alive; cancelExecutingRun invokes it (a no-op for a token
  // with no executing worker) so the renderer's Stop can kill the Python run.
  registerExecutingWorkerKill(token: string, killWorker: () => void): void;
  clearExecutingWorkerKill(token: string): void;
  cancelExecutingRun(token: string): void;
}

interface SpooledCubeFile {
  readonly handle: FileHandle;
  readonly path: string;
}

interface PendingCubeResultPull {
  readonly totalBytes: number;
  handle: FileHandle | null;
  readOffsetBytes: number;
}

interface ChunkedUserScriptRunSession {
  readonly request: BeginChunkedUserScriptRunRequest;
  readonly expectedCubeBytes: number;
  readonly resultSpoolPath: string;
  cubeFile: SpooledCubeFile | null;
  hasExecuted: boolean;
  receivedCubeBytes: number;
  hasReleasedInputResources: boolean;
  resultPull: PendingCubeResultPull | null;
  killExecutingWorker: (() => void) | null;
}

export function createChunkedUserScriptRunSessionStore(
  chunkBytes: number = USER_SCRIPT_RUN_CHUNK_BYTES,
  temporaryDirectory: string = tmpdir(),
): ChunkedUserScriptRunSessionStore {
  const sessions = new Map<string, ChunkedUserScriptRunSession>();
  return {
    begin: (request) => beginSession(sessions, request, temporaryDirectory),
    appendCubeChunk: async (token, bytes) =>
      appendChunkToSessionCubeFile(requireSession(sessions, token), bytes),
    takeExecutableRun: (token) => takeExecutableRunFromSession(requireSession(sessions, token), chunkBytes),
    releaseInputResourcesAfterRun: (token) => releaseSessionInputResources(sessions.get(token)),
    storeCubeResultForPull: (token, shape, bands) =>
      storeCubeResultOnSession(requireSession(sessions, token), shape, bands),
    readNextResultChunk: async (token) =>
      readNextResultChunkFromSession(requireSession(sessions, token), chunkBytes),
    release: (token) => releaseSessionDiscardingState(sessions, token),
    registerExecutingWorkerKill: (token, killWorker) => {
      const session = sessions.get(token);
      if (session) session.killExecutingWorker = killWorker;
    },
    clearExecutingWorkerKill: (token) => {
      const session = sessions.get(token);
      if (session) session.killExecutingWorker = null;
    },
    cancelExecutingRun: (token) => sessions.get(token)?.killExecutingWorker?.(),
  };
}

async function beginSession(
  sessions: Map<string, ChunkedUserScriptRunSession>,
  request: BeginChunkedUserScriptRunRequest,
  temporaryDirectory: string,
): Promise<string> {
  const expectedCubeBytes = cubeByteLengthOfDescriptor(request.cube);
  const token = randomUUID();
  sessions.set(token, {
    request,
    expectedCubeBytes,
    resultSpoolPath: join(temporaryDirectory, `msi-user-script-cube-result-${token}.bin`),
    cubeFile: await openCubeSpoolFile(temporaryDirectory, token),
    hasExecuted: false,
    receivedCubeBytes: 0,
    hasReleasedInputResources: false,
    resultPull: null,
    killExecutingWorker: null,
  });
  return token;
}

async function openCubeSpoolFile(
  temporaryDirectory: string,
  token: string,
): Promise<SpooledCubeFile> {
  const path = join(temporaryDirectory, `msi-user-script-cube-${token}.bin`);
  return { handle: await open(path, "w+"), path };
}

function cubeByteLengthOfDescriptor(cube: UserScriptRunCubeDescriptor): number {
  const { bandCount, height, width } = cube;
  if (!isPositiveInteger(bandCount) || !isPositiveInteger(height) || !isPositiveInteger(width)) {
    throw new Error("The script run described an invalid stack shape.");
  }
  return bandCount * height * width * Float32Array.BYTES_PER_ELEMENT;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function requireSession(
  sessions: Map<string, ChunkedUserScriptRunSession>,
  token: string,
): ChunkedUserScriptRunSession {
  const session = sessions.get(token);
  if (session === undefined) throw new Error("Unknown user-script run token");
  return session;
}

async function appendChunkToSessionCubeFile(
  session: ChunkedUserScriptRunSession,
  bytes: Uint8Array,
): Promise<void> {
  if (session.cubeFile === null || session.hasExecuted) {
    throw new Error("This user-script run already executed");
  }
  if (bytes.byteLength === 0 || session.receivedCubeBytes + bytes.byteLength > session.expectedCubeBytes) {
    throw new Error("The uploaded stack bytes did not match the described stack shape.");
  }
  await writeExactLengthAtOffset(session.cubeFile.handle, bytes, session.receivedCubeBytes);
  session.receivedCubeBytes += bytes.byteLength;
}

// FileHandle.write may write fewer bytes than asked; an unchecked short write
// leaves silent holes in the spool file (observed as truncated worker input).
async function writeExactLengthAtOffset(
  handle: FileHandle,
  bytes: Uint8Array,
  offsetBytes: number,
): Promise<void> {
  let written = 0;
  while (written < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, written, bytes.byteLength - written, offsetBytes + written);
    if (bytesWritten === 0) throw new Error("A spooled stack write made no progress");
    written += bytesWritten;
  }
}

function takeExecutableRunFromSession(
  session: ChunkedUserScriptRunSession,
  chunkBytes: number,
): ExecutableUserScriptRun {
  if (session.cubeFile === null || session.hasExecuted) {
    throw new Error("This user-script run already executed");
  }
  if (session.receivedCubeBytes !== session.expectedCubeBytes) {
    throw new Error("The uploaded stack bytes did not match the described stack shape.");
  }
  session.hasExecuted = true;
  return describeExecutableRun(session, chunkBytes);
}

function describeExecutableRun(
  session: ChunkedUserScriptRunSession,
  chunkBytes: number,
): ExecutableUserScriptRun {
  const { request, expectedCubeBytes } = session;
  return {
    input: request.input,
    cube: {
      header: buildCubePayloadHeaderFromDescriptor(request.cube),
      totalByteLength: expectedCubeBytes,
      readSegments: () => readSpooledCubeSegments(session, chunkBytes),
    },
    resultKind: request.resultKind,
    sourceName: request.sourceName,
    interpreterPath: request.interpreterPath,
    sandbox: request.sandbox,
    cubeResultSpoolPath: session.resultSpoolPath,
  };
}

// Streams the spooled upload back off disk one chunk at a time, REUSING one
// buffer for the whole stream: the consumer awaits each write's flush before
// pulling the next segment, and avoiding gigabytes of allocation churn matters
// in Electron main, where a burst of large short-lived buffers can outrun GC
// and fatally fail a later allocation (CT-219g).
async function* readSpooledCubeSegments(
  session: ChunkedUserScriptRunSession,
  chunkBytes: number,
): AsyncIterable<Buffer> {
  const file = session.cubeFile;
  if (file === null) throw new Error("The uploaded stack bytes were already released.");
  const reusedSegment = Buffer.allocUnsafe(Math.min(chunkBytes, session.expectedCubeBytes));
  for (let offset = 0; offset < session.expectedCubeBytes; offset += chunkBytes) {
    const length = Math.min(chunkBytes, session.expectedCubeBytes - offset);
    const segment = reusedSegment.subarray(0, length);
    await readExactLengthAtOffset(file.handle, segment, offset);
    yield segment;
  }
}

async function readExactLengthAtOffset(
  handle: FileHandle,
  target: Buffer,
  offsetBytes: number,
): Promise<void> {
  let filled = 0;
  while (filled < target.length) {
    const { bytesRead } = await handle.read(target, filled, target.length - filled, offsetBytes + filled);
    if (bytesRead === 0) throw new Error("Unexpected end of a spooled stack file");
    filled += bytesRead;
  }
}

function buildCubePayloadHeaderFromDescriptor(
  cube: UserScriptRunCubeDescriptor,
): EncodedCubePayload["header"] {
  return {
    shape: [cube.bandCount, cube.height, cube.width],
    dtype: "float32",
    wavelengths: cube.wavelengths,
  };
}

// Releases everything the worker needed as input: the imported-script temp
// resources AND the spooled cube file (the run has consumed both by the time
// this is called from the execute handler's finally).
async function releaseSessionInputResources(
  session: ChunkedUserScriptRunSession | undefined,
): Promise<void> {
  if (session === undefined) return;
  await discardSpooledCubeFile(session);
  if (session.hasReleasedInputResources) return;
  session.hasReleasedInputResources = true;
  await session.request.releaseInputResources();
}

async function discardSpooledCubeFile(session: ChunkedUserScriptRunSession): Promise<void> {
  const file = session.cubeFile;
  if (file === null) return;
  session.cubeFile = null;
  await file.handle.close().catch(() => undefined);
  await unlink(file.path).catch(() => undefined);
}

function storeCubeResultOnSession(
  session: ChunkedUserScriptRunSession,
  shape: [number, number, number],
  totalBytes: number,
): StoredCubeResultSummary {
  const shapeBytes = shape[0] * shape[1] * shape[2] * Float32Array.BYTES_PER_ELEMENT;
  if (shapeBytes !== totalBytes) {
    throw new Error("The script result bands did not match its stack shape.");
  }
  session.resultPull = { totalBytes, handle: null, readOffsetBytes: 0 };
  return { totalBytes };
}

// Pull chunks read straight off the result spool file, so the result cube
// never materializes in main memory either; each reply carries a fresh
// exactly-sized Buffer.
async function readNextResultChunkFromSession(
  session: ChunkedUserScriptRunSession,
  chunkBytes: number,
): Promise<UserScriptRunResultChunkResult> {
  const pull = session.resultPull;
  if (pull === null) throw new Error("This user-script run has no stack result to read");
  if (pull.readOffsetBytes >= pull.totalBytes) {
    throw new Error("The stack result was already fully read");
  }
  const handle = await openResultPullHandle(session, pull);
  const length = Math.min(chunkBytes, pull.totalBytes - pull.readOffsetBytes);
  const bytes = Buffer.allocUnsafe(length);
  await readExactLengthAtOffset(handle, bytes, pull.readOffsetBytes);
  pull.readOffsetBytes += length;
  return { done: pull.readOffsetBytes >= pull.totalBytes, bytes };
}

async function openResultPullHandle(
  session: ChunkedUserScriptRunSession,
  pull: PendingCubeResultPull,
): Promise<FileHandle> {
  if (pull.handle !== null) return pull.handle;
  pull.handle = await open(session.resultSpoolPath, "r");
  return pull.handle;
}

async function releaseSessionDiscardingState(
  sessions: Map<string, ChunkedUserScriptRunSession>,
  token: string,
): Promise<void> {
  const session = sessions.get(token);
  if (session === undefined) return;
  sessions.delete(token);
  await discardResultSpool(session);
  await releaseSessionInputResources(session);
}

async function discardResultSpool(session: ChunkedUserScriptRunSession): Promise<void> {
  const pull = session.resultPull;
  session.resultPull = null;
  await pull?.handle?.close().catch(() => undefined);
  await unlink(session.resultSpoolPath).catch(() => undefined);
}
