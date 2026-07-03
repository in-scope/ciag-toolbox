// TS/Node subprocess worker harness for user Python scripts: spawn, typed IPC,
// hard wall-clock timeout, and kill all live here; only the scriptSource is Python.
// Expected failures (script errors, timeouts, crashes) resolve as a failed outcome
// with a user-facing message; this function never rejects for them.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { EncodedCubePayload } from "./cube-payload";
import { PYTHON_WORKER_BOOTSTRAP_SOURCE } from "./worker-bootstrap";
import {
  encodeRawBinaryFrame,
  encodeWorkerRequestFrame,
  WorkerResponseFrameDecoder,
  type JsonValue,
  type PythonWorkerResponse,
  type RunUserScriptRequest,
  type UserScriptInput,
} from "./worker-protocol";

export interface PythonWorkerRunRequest {
  interpreterPath: string;
  input: UserScriptInput;
  cube: EncodedCubePayload | null;
  // True in bundled mode (the app's own interpreter, sandboxed); false in the
  // explicitly-trusted own-environment mode (CT-208e). The wall-clock kill applies either way.
  sandbox: boolean;
  timeoutMs: number;
}

export type PythonWorkerFailureReason = "script-error" | "timeout" | "worker-crashed";

export type PythonWorkerOutcome =
  | { kind: "completed"; value: JsonValue }
  | { kind: "failed"; reason: PythonWorkerFailureReason; userFacingMessage: string; detail?: string };

const STDERR_DETAIL_LIMIT_BYTES = 8192;

export async function runUserScriptInPythonSubprocess(
  request: PythonWorkerRunRequest,
): Promise<PythonWorkerOutcome> {
  const worker = spawnPythonWorkerProcess(request.interpreterPath);
  sendRunUserScriptRequestToWorker(worker, request);
  return new Promise((resolveOutcome) => {
    new PythonWorkerRunObserver(worker, request.timeoutMs, resolveOutcome).beginObserving();
  });
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
  worker.stdin.write(encodeRunUserScriptTransmission(request));
  worker.stdin.end();
}

function encodeRunUserScriptTransmission(request: PythonWorkerRunRequest): Buffer {
  const requestFrame = encodeWorkerRequestFrame(buildWorkerRequest(request));
  if (request.cube === null) return requestFrame;
  return Buffer.concat([requestFrame, encodeRawBinaryFrame(request.cube.buffer)]);
}

function buildWorkerRequest(request: PythonWorkerRunRequest): RunUserScriptRequest {
  return {
    type: "run-user-script",
    input: request.input,
    cube: request.cube?.header ?? null,
    sandbox: request.sandbox,
  };
}

function outcomeFromWorkerResponse(response: PythonWorkerResponse): PythonWorkerOutcome {
  if (response.type === "script-result") return { kind: "completed", value: response.value };
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
      if (firstResponse !== undefined) this.settle(outcomeFromWorkerResponse(firstResponse));
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
