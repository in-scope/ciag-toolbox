import { SCRIPTING_DOCS_HINT } from "./user-script-return-contract";

// The Custom transform editor CONFIGURES the run instead of executing it: the
// Python runs at Apply time (unlike band weighting and band selection, which
// still run at Run formula / Import script time). The editing state carries
// the chosen input only - a formula expression or an imported tool's file
// path - never band data. Apply reads it, runs the worker, and opens the
// transformed stack; the config survives the apply so a corrected script can
// be re-applied without re-importing.

export type CubeTransformEditingState =
  | { readonly kind: "formula"; readonly expression: string }
  | { readonly kind: "tool"; readonly filePath: string; readonly fileName: string };

export const NO_CUBE_TRANSFORM_SET_STATUS =
  "No transform set. Enter a formula or import a tool.";

// A blank expression means nothing is configured, so the editor can bind the
// field text straight through and Apply still gets a clear "nothing set" error.
export function buildFormulaCubeTransformState(
  expression: string,
): CubeTransformEditingState | null {
  return expression.trim() === "" ? null : { kind: "formula", expression };
}

export function buildImportedToolCubeTransformState(
  filePath: string,
  fileName: string,
): CubeTransformEditingState {
  return { kind: "tool", filePath, fileName };
}

export function formatCubeTransformStatusLine(state: CubeTransformEditingState | null): string {
  if (!state) return NO_CUBE_TRANSFORM_SET_STATUS;
  if (state.kind === "formula") return "Formula set. Apply runs it on the stack.";
  return `Tool loaded: ${state.fileName}. Apply runs it on the stack.`;
}

// The applied label and History record the formula text or the tool's file name.
export function describeCubeTransformForAudit(state: CubeTransformEditingState): string {
  return state.kind === "formula" ? state.expression.trim() : state.fileName;
}

// Worker failures (script error, timeout, crash) do not carry the return-format
// pointer the renderer-side contract errors already end with, so the error text
// appends it once here.
export function describeCubeTransformRunError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.endsWith(SCRIPTING_DOCS_HINT) ? message : `${message} ${SCRIPTING_DOCS_HINT}`;
}
