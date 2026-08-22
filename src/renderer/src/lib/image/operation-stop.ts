// CT-268: cooperative cancellation for long-running applies. The apply flow
// owns an AbortController per stoppable run; its signal threads through
// runActionSourceTransform into every transformSourceAsync operation, and the
// chunked compute helpers (unit-progress.ts and the per-band loops built on
// them) check it at each chunk boundary. A stopped run surfaces as an
// OperationStoppedError, which the apply flow reports as the transient
// "Operation stopped" toast instead of a failure.

export const OPERATION_STOPPED_MESSAGE = "Operation stopped";

export class OperationStoppedError extends Error {
  constructor() {
    super(OPERATION_STOPPED_MESSAGE);
    this.name = "OperationStoppedError";
  }
}

export function isOperationStoppedError(error: unknown): error is OperationStoppedError {
  return error instanceof Error && error.name === "OperationStoppedError";
}

export function throwIfOperationStopped(abortSignal: AbortSignal | undefined): void {
  if (abortSignal?.aborted) throw new OperationStoppedError();
}
