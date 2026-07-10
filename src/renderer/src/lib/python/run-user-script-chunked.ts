import { USER_SCRIPT_RUN_CHUNK_BYTES } from "@shared/chunked-user-script-run-protocol";

import { describeElectronInvokeFailure } from "@/lib/ipc/electron-invoke-error";
import { createCubeResultChunkAssembler } from "./cube-result-chunk-assembler";

// CT-219g: drives the chunked user-script run protocol from the renderer. The
// old single window.toolboxApi.runUserScript invoke carried the whole cube
// (~3 GB at reference scale) and V8's ValueSerializer killed the renderer
// process outright once the wire buffer doubled past Chromium's 2 GiB
// single-allocation cap (measured cliff between 1.0 and 1.5 GB aggregate).
// This orchestrator streams the cube up band by band in small chunks, executes
// the run, and pulls a cube result back down the same way, so no context-bridge
// crossing or invoke ever approaches the danger zone and every await between
// chunks keeps the renderer interactive. The api is injected so the sequencing
// is unit-testable without the bridge.

export interface UserScriptRunCubeInput {
  readonly bandCount: number;
  readonly height: number;
  readonly width: number;
  readonly wavelengths: number[] | null;
  // Bands are pulled one at a time so integer sources convert to float32
  // lazily, band by band, instead of holding a whole second copy of the stack.
  readonly getBandAsFloat32: (bandIndex: number) => Float32Array;
}

export interface UserScriptRunChunkedApi {
  beginUserScriptRun(request: ToolboxUserScriptRunBeginRequest): Promise<ToolboxUserScriptRunBeginResult>;
  sendUserScriptRunCubeChunk(request: ToolboxUserScriptRunCubeChunkRequest): Promise<void>;
  executeUserScriptRun(request: ToolboxUserScriptRunExecuteRequest): Promise<ToolboxUserScriptRunExecuteResult>;
  readUserScriptRunResultChunk(
    request: ToolboxUserScriptRunResultChunkRequest,
  ): Promise<ToolboxUserScriptRunResultChunkResult>;
  releaseUserScriptRun(request: ToolboxUserScriptRunReleaseRequest): Promise<void>;
}

export interface ChunkedUserScriptRunCallbacks {
  // Fired after the run is prepared (the import dialog, when any, is resolved)
  // and the cube transfer is about to start; register busy feedback here.
  readonly onRunReady?: () => void;
  // Upload fraction 0..1 while the cube streams up, then null (indeterminate)
  // while the worker runs and any cube result pulls back down.
  readonly onUploadProgress?: (fraction: number | null) => void;
}

export async function runUserScriptOverCubeInChunks(
  api: UserScriptRunChunkedApi,
  cube: UserScriptRunCubeInput,
  source: ToolboxRunUserScriptSource,
  resultKind: ToolboxRunUserScriptResultKind,
  callbacks: ChunkedUserScriptRunCallbacks = {},
  chunkBytes: number = USER_SCRIPT_RUN_CHUNK_BYTES,
): Promise<ToolboxRunUserScriptResult> {
  const begun = await api.beginUserScriptRun({ source, resultKind, cube: describeCube(cube) });
  if (begun.status !== "ready") return begun;
  callbacks.onRunReady?.();
  try {
    return await transferCubeAndExecuteRun(api, cube, begun.token, begun.sourceName, callbacks, chunkBytes);
  } catch (error) {
    return { status: "failed", message: describeUserScriptRunTransferFailure(error) };
  } finally {
    await api.releaseUserScriptRun({ token: begun.token }).catch(() => undefined);
  }
}

function describeCube(cube: UserScriptRunCubeInput): ToolboxUserScriptRunCubeDescriptor {
  return {
    bandCount: cube.bandCount,
    height: cube.height,
    width: cube.width,
    wavelengths: cube.wavelengths,
  };
}

async function transferCubeAndExecuteRun(
  api: UserScriptRunChunkedApi,
  cube: UserScriptRunCubeInput,
  token: string,
  sourceName: string | null,
  callbacks: ChunkedUserScriptRunCallbacks,
  chunkBytes: number,
): Promise<ToolboxRunUserScriptResult> {
  await uploadCubeBandsInChunks(api, cube, token, chunkBytes, callbacks.onUploadProgress);
  callbacks.onUploadProgress?.(null);
  const executed = await api.executeUserScriptRun({ token });
  return assembleExecutedRunResult(api, token, executed, sourceName);
}

async function uploadCubeBandsInChunks(
  api: UserScriptRunChunkedApi,
  cube: UserScriptRunCubeInput,
  token: string,
  chunkBytes: number,
  onProgress: ((fraction: number | null) => void) | undefined,
): Promise<void> {
  const totalBytes = cube.bandCount * cube.height * cube.width * Float32Array.BYTES_PER_ELEMENT;
  onProgress?.(0);
  let sentBytes = 0;
  for (let bandIndex = 0; bandIndex < cube.bandCount; bandIndex += 1) {
    const band = takeBandMatchingCubeShape(cube, bandIndex);
    sentBytes = await uploadOneBandInChunks(api, token, band, chunkBytes, sentBytes, totalBytes, onProgress);
  }
}

function takeBandMatchingCubeShape(cube: UserScriptRunCubeInput, bandIndex: number): Float32Array {
  const band = cube.getBandAsFloat32(bandIndex);
  if (band.length !== cube.height * cube.width) {
    throw new Error("A stack band did not match the described stack shape.");
  }
  return band;
}

async function uploadOneBandInChunks(
  api: UserScriptRunChunkedApi,
  token: string,
  band: Float32Array,
  chunkBytes: number,
  sentBytes: number,
  totalBytes: number,
  onProgress: ((fraction: number | null) => void) | undefined,
): Promise<number> {
  const bandBytes = new Uint8Array(band.buffer, band.byteOffset, band.byteLength);
  let sent = sentBytes;
  for (let offset = 0; offset < bandBytes.byteLength; offset += chunkBytes) {
    // slice copies, so the IPC layer never serializes a view over the whole band.
    const chunk = bandBytes.slice(offset, Math.min(offset + chunkBytes, bandBytes.byteLength));
    await api.sendUserScriptRunCubeChunk({ token, bytes: chunk });
    sent += chunk.byteLength;
    onProgress?.(sent / totalBytes);
  }
  return sent;
}

async function assembleExecutedRunResult(
  api: UserScriptRunChunkedApi,
  token: string,
  executed: ToolboxUserScriptRunExecuteResult,
  sourceName: string | null,
): Promise<ToolboxRunUserScriptResult> {
  if (executed.status === "failed") return executed;
  if (executed.status === "completed") {
    return attachSourceName({ status: "completed", value: executed.value }, sourceName);
  }
  const bands = await pullResultCubeBands(api, token, executed.shape, executed.totalBytes);
  return attachSourceName({ status: "completed-cube", shape: executed.shape, bands }, sourceName);
}

async function pullResultCubeBands(
  api: UserScriptRunChunkedApi,
  token: string,
  shape: [number, number, number],
  totalBytes: number,
): Promise<Float32Array[]> {
  const assembler = createCubeResultChunkAssembler(shape, totalBytes);
  let done = false;
  while (!done) {
    const chunk = await api.readUserScriptRunResultChunk({ token });
    assembler.append(chunk.bytes);
    done = chunk.done;
  }
  return assembler.finish();
}

function attachSourceName(
  result: Extract<ToolboxRunUserScriptResult, { status: "completed" | "completed-cube" }>,
  sourceName: string | null,
): ToolboxRunUserScriptResult {
  if (sourceName === null) return result;
  return { ...result, sourceName };
}

export function describeUserScriptRunTransferFailure(error: unknown): string {
  return describeElectronInvokeFailure(error);
}
