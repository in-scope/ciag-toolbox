// The CT-239 in-vocabulary refusal copy for an operation that cannot fit in
// memory. It lives in src/shared because two boundaries surface it: the
// renderer's raster-memory-budget preflight (the ArrayBuffer-pool gate) and
// the main process's user-script run gate (the Python worker's system-memory
// preflight, CT-241). Keep the wording identical everywhere - the scale10
// sweep asserts this exact string.
export const OPERATION_MEMORY_REFUSAL_MESSAGE =
  "There is not enough memory for this operation with the current panels open. " +
  "Close panels you no longer need, use a band-wise scope, or crop the stack and try again.";
