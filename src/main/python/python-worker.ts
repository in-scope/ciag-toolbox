// TS/Node subprocess worker harness for user Python scripts: spawn, typed IPC,
// hard wall-clock timeout, and kill all live here; only the scriptSource is Python.
// Expected failures (script errors, timeouts, crashes) resolve as a failed outcome
// with a user-facing message; this function never rejects for them.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { EncodedCubePayload } from "./cube-payload";
import { PYTHON_WORKER_BOOTSTRAP_SOURCE } from "./worker-bootstrap";
import {
  encodeCubeFrameLengthPrefix,
  encodeWorkerRequestFrame,
  WorkerResponseFrameDecoder,
  type CubeResultShape,
  type JsonValue,
  type PythonWorkerResponse,
  type RunUserScriptRequest,
  type UserScriptInput,
  type UserScriptResultKind,
} from "./worker-protocol";

export interface PythonWorkerRunRequest {
  interpreterPath: string;
  input: UserScriptInput;
  cube: EncodedCubePayload | null;
  // 'value' returns JSON (weight vectors, bands); a 'cube' run's WORKER writes
  // the raw float32 result straight into cubeResultSpoolPath and answers with a
  // small JSON header (CT-219g: a reference-scale result is ~3 GB, and a
  // multi-gigabyte stdout frame makes this process's pipe read allocate one
  // over-2GiB buffer, a fatal native OOM). The outcome reports the file.
  resultKind: UserScriptResultKind;
  cubeResultSpoolPath?: string;
  // True in bundled mode (the app's own interpreter, sandboxed); false in the
  // explicitly-trusted own-environment mode (CT-208e). The wall-clock kill applies either way.
  sandbox: boolean;
  timeoutMs: number;
  // CT-268: called with the run's cancel trigger once observation starts. The
  // caller invokes it (from the cancel IPC) to SIGKILL the subprocess; the run
  // then settles as a "canceled" failure instead of hanging to the timeout.
  registerCancel?: (cancelRun: () => void) => void;
}

export type PythonWorkerFailureReason = "script-error" | "timeout" | "worker-crashed" | "canceled";

export type PythonWorkerOutcome =
  | { kind: "completed"; value: JsonValue }
  | { kind: "completed-cube"; shape: CubeResultShape; totalBytes: number; spoolPath: string }
  | { kind: "failed"; reason: PythonWorkerFailureReason; userFacingMessage: string; detail?: string };

const STDERR_DETAIL_LIMIT_BYTES = 8192;

export async function runUserScriptInPythonSubprocess(
  request: PythonWorkerRunRequest,
): Promise<PythonWorkerOutcome> {
  const spoolPath = requireCubeSpoolPathForCubeRuns(request);
  const worker = spawnPythonWorkerProcess(request.interpreterPath);
  sendRunUserScriptRequestToWorker(worker, request);
  return new Promise((resolveOutcome) => {
    const observer = new PythonWorkerRunObserver(worker, request.timeoutMs, spoolPath, resolveOutcome);
    observer.beginObserving();
    request.registerCancel?.(() => observer.cancelBecauseUserStopped());
  });
}

// A missing spool path on a cube run is a harness bug, not a user failure.
function requireCubeSpoolPathForCubeRuns(request: PythonWorkerRunRequest): string | null {
  if (request.resultKind !== "cube") return null;
  if (request.cubeResultSpoolPath === undefined) {
    throw new Error("A cube-result run requires a cubeResultSpoolPath");
  }
  return request.cubeResultSpoolPath;
}

function spawnPythonWorkerProcess(interpreterPath: string): ChildProcessWithoutNullStreams {
  // -I (isolated) ignores PYTHON* environment variables and user site-packages;
  // the full bundled-mode sandbox is CT-208d.
  return spawn(interpreterPath, ["-I", "-X", "utf8", "-c", PYTHON_WORKER_BOOTSTRAP_SOURCE], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

function sendRunUserScriptRequestToWorker(
  worker: ChildProcessWithoutNullStreams,
  request: PythonWorkerRunRequest,
): void {
  worker.stdin.on("error", () => undefined);
  void writeRunRequestFramesSequentially(worker.stdin, request);
}

// The raw cube frame goes out as its length prefix followed by each streamed
// segment, ONE flushed write at a time, never concatenated or queued together:
// a reference-scale cube (~3 GB) cannot exist as one Buffer in a Chromium
// process (the 2 GiB PartitionAlloc cap, CT-219g), and letting segments queue
// on the stream lets Node batch them into a single writev that libuv on
// Windows coalesces into one over-cap allocation - a fatal native crash of the
// MAIN process 47 ms after stdin.end() (observed 2026-07-10). A segment-read
// failure destroys stdin so the worker sees EOF and the run settles as a
// crash outcome instead of hanging.
async function writeRunRequestFramesSequentially(
  stdin: ChildProcessWithoutNullStreams["stdin"],
  request: PythonWorkerRunRequest,
): Promise<void> {
  try {
    await writeToStreamAwaitingFlush(stdin, encodeWorkerRequestFrame(buildWorkerRequest(request)));
    await writeCubePayloadAsRawFrame(stdin, request.cube);
    stdin.end();
  } catch {
    stdin.destroy();
  }
}

async function writeCubePayloadAsRawFrame(
  stdin: ChildProcessWithoutNullStreams["stdin"],
  cube: EncodedCubePayload | null,
): Promise<void> {
  if (cube === null) return;
  await writeToStreamAwaitingFlush(stdin, encodeCubeFrameLengthPrefix(cube.totalByteLength));
  for await (const segment of cube.readSegments()) {
    await writeToStreamAwaitingFlush(stdin, segment);
  }
}

// Resolves regardless of write errors: a dead worker settles the run through
// the close/error observers, and Node invokes pending write callbacks (with an
// error) when the stream is destroyed, so this never dangles.
function writeToStreamAwaitingFlush(
  stdin: ChildProcessWithoutNullStreams["stdin"],
  bytes: Buffer,
): Promise<void> {
  return new Promise((resolve) => {
    stdin.write(bytes, () => resolve());
  });
}

function buildWorkerRequest(request: PythonWorkerRunRequest): RunUserScriptRequest {
  return {
    type: "run-user-script",
    input: request.input,
    cube: request.cube?.header ?? null,
    resultKind: request.resultKind,
    cubeResultSpoolPath: request.cubeResultSpoolPath ?? null,
    sandbox: request.sandbox,
  };
}

function outcomeFromWorkerResponse(
  response: PythonWorkerResponse,
  cubeSpoolPath: string | null,
): PythonWorkerOutcome {
  if (response.type === "script-result") return { kind: "completed", value: response.value };
  if (response.type === "cube-result") {
    if (cubeSpoolPath === null) throw new Error("cube result arrived without a spool path");
    return {
      kind: "completed-cube",
      shape: response.shape,
      totalBytes: response.totalBytes,
      spoolPath: cubeSpoolPath,
    };
  }
  return {
    kind: "failed",
    reason: "script-error",
    userFacingMessage: `The script failed: ${response.message}`,
    detail: response.traceback,
  };
}

class PythonWorkerRunObserver {
  private readonly responseDecoder = new WorkerResponseFrameDecoder();
  private readonly stderrChunks: Buffer[] = [];
  private timeoutTimer: NodeJS.Timeout | undefined;
  private hasSettled = false;

  constructor(
    private readonly worker: ChildProcessWithoutNullStreams,
    private readonly timeoutMs: number,
    private readonly cubeSpoolPath: string | null,
    private readonly settleWithOutcome: (outcome: PythonWorkerOutcome) => void,
  ) {}

  beginObserving(): void {
    this.worker.stdout.on("data", (chunk: Buffer) => this.handleStdoutChunk(chunk));
    this.worker.stderr.on("data", (chunk: Buffer) => this.collectStderrChunk(chunk));
    this.worker.on("error", (error) => this.settleAsCrashed(error.message));
    // "close" (not "exit") so buffered stdout data events flush before we
    // conclude the worker died without responding.
    this.worker.on("close", () => this.handleExitBeforeAnyResponse());
    this.timeoutTimer = setTimeout(() => this.handleWallClockTimeout(), this.timeoutMs);
  }

  private handleStdoutChunk(chunk: Buffer): void {
    try {
      const responses = this.responseDecoder.appendChunkAndTakeCompletedResponses(chunk);
      const firstResponse = responses[0];
      if (firstResponse !== undefined) this.settle(outcomeFromWorkerResponse(firstResponse, this.cubeSpoolPath));
    } catch (decodeError) {
      this.settleAsCrashed(decodeError instanceof Error ? decodeError.message : String(decodeError));
    }
  }

  private collectStderrChunk(chunk: Buffer): void {
    if (this.collectedStderrLength() < STDERR_DETAIL_LIMIT_BYTES) this.stderrChunks.push(chunk);
  }

  private collectedStderrLength(): number {
    return this.stderrChunks.reduce((total, chunk) => total + chunk.length, 0);
  }

  private handleExitBeforeAnyResponse(): void {
    this.settleAsCrashed(Buffer.concat(this.stderrChunks).toString("utf8").trim() || undefined);
  }

  private handleWallClockTimeout(): void {
    const seconds = Math.round(this.timeoutMs / 100) / 10;
    this.settle({
      kind: "failed",
      reason: "timeout",
      userFacingMessage: `The script exceeded the ${seconds}-second limit and was stopped.`,
    });
  }

  // CT-268: a user Stop settles the run and SIGKILLs the subprocess (settle's
  // killWorkerIfStillRunning). The message is rarely user-visible - the
  // renderer converts a stopped run into its own "Operation stopped" toast.
  cancelBecauseUserStopped(): void {
    this.settle({
      kind: "failed",
      reason: "canceled",
      userFacingMessage: "The script run was stopped.",
    });
  }

  private settleAsCrashed(detail?: string): void {
    this.settle({
      kind: "failed",
      reason: "worker-crashed",
      userFacingMessage: "The script process ended unexpectedly.",
      detail,
    });
  }

  private settle(outcome: PythonWorkerOutcome): void {
    if (this.hasSettled) return;
    this.hasSettled = true;
    if (this.timeoutTimer !== undefined) clearTimeout(this.timeoutTimer);
    this.killWorkerIfStillRunning();
    this.settleWithOutcome(outcome);
  }

  private killWorkerIfStillRunning(): void {
    if (this.worker.exitCode === null && !this.worker.killed) this.worker.kill("SIGKILL");
  }
}
