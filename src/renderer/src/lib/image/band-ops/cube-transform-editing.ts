import { SCRIPTING_DOCS_HINT } from "./user-script-return-contract";

// CT-216: pure helpers for the Custom transform editor. The editing state rides
// in ViewportRenderingState and carries the result-store token plus display
// strings only, never band data: sourceLabel names the input form for the panel's
// status line, and auditDescription is what the applied label and History record
// (the formula expression, or the imported tool's file name).

export interface CubeTransformEditingState {
  readonly token: string;
  readonly sourceLabel: string;
  readonly auditDescription: string;
  readonly outputBandCount: number;
}

export const FORMULA_CUBE_TRANSFORM_LABEL = "Formula";
export const NO_CUBE_TRANSFORM_READY_STATUS =
  "No transform ready. Run a formula or import a tool.";

export function buildFormulaCubeTransformState(
  token: string,
  outputBandCount: number,
  expression: string,
): CubeTransformEditingState {
  return { token, outputBandCount, sourceLabel: FORMULA_CUBE_TRANSFORM_LABEL, auditDescription: expression };
}

export function buildImportedToolCubeTransformState(
  token: string,
  outputBandCount: number,
  sourceName: string | undefined,
): CubeTransformEditingState {
  const toolName = sourceName ?? "script";
  return { token, outputBandCount, sourceLabel: `Imported tool: ${toolName}`, auditDescription: toolName };
}

export function formatCubeTransformStatusLine(state: CubeTransformEditingState | null): string {
  if (!state) return NO_CUBE_TRANSFORM_READY_STATUS;
  return `Transform ready: ${state.sourceLabel} (${formatOutputBandCount(state.outputBandCount)})`;
}

function formatOutputBandCount(count: number): string {
  return count === 1 ? "1 band" : `${count} bands`;
}

// Worker failures (script error, timeout, crash) do not carry the return-format
// pointer the renderer-side contract errors already end with, so the toast text
// appends it once here.
export function describeCubeTransformRunError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.endsWith(SCRIPTING_DOCS_HINT) ? message : `${message} ${SCRIPTING_DOCS_HINT}`;
}
