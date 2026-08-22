import type { BandSelectionEditingState, BandSelectionPreset } from "./band-selection";

// CT-293: pure helpers for the "By function" editor. The three functions are ONE
// exclusive choice - Average, Variance, Custom - so the segmented control reads
// its value from the staged choice and writes a whole new choice back. Custom
// only CONFIGURES the run (a formula expression or an imported tool's file path,
// never band data); the Python executes at Apply, the CT-216 pattern.

export type BandSelectionFunctionMode = "average" | "variance" | "custom";

export const BAND_SELECTION_PRESET_LABELS: Record<BandSelectionPreset, string> = {
  average: "Average",
  variance: "Variance",
};

export const FORMULA_BAND_SELECTION_DESCRIPTION = "Formula";

export const NO_CUSTOM_BAND_FUNCTION_SET_STATUS =
  "No formula set. Enter a formula or import a tool.";

// Picking Custom stages an EMPTY formula rather than nothing, so the segmented
// control keeps Custom selected while the user is still typing.
const EMPTY_CUSTOM_BAND_SELECTION: CustomBandSelection = Object.freeze({
  kind: "formula",
  expression: "",
});

export type CustomBandSelection = Exclude<BandSelectionEditingState, { kind: "preset" }>;

export function isCustomBandSelection(
  choice: BandSelectionEditingState | null,
): choice is CustomBandSelection {
  return choice !== null && choice.kind !== "preset";
}

export function readBandSelectionFunctionMode(
  choice: BandSelectionEditingState | null,
): BandSelectionFunctionMode {
  if (choice === null) return "average";
  return choice.kind === "preset" ? choice.preset : "custom";
}

export function buildBandSelectionChoiceForMode(
  mode: BandSelectionFunctionMode,
  currentChoice: BandSelectionEditingState | null,
): BandSelectionEditingState {
  if (mode !== "custom") return { kind: "preset", preset: mode };
  return isCustomBandSelection(currentChoice) ? currentChoice : EMPTY_CUSTOM_BAND_SELECTION;
}

export function buildFormulaBandSelectionState(expression: string): CustomBandSelection {
  return { kind: "formula", expression };
}

export function buildImportedToolBandSelectionState(
  filePath: string,
  fileName: string,
): CustomBandSelection {
  return { kind: "tool", filePath, fileName };
}

// The formula field is blank whenever a tool is the configured input; typing
// into it switches the choice back to a formula.
export function readBandSelectionFormulaText(choice: BandSelectionEditingState | null): string {
  return choice?.kind === "formula" ? choice.expression : "";
}

export function formatBandSelectionCustomInputStatus(
  choice: BandSelectionEditingState | null,
): string {
  if (choice?.kind === "tool") return `Tool loaded: ${choice.fileName}. Apply runs it on the stack.`;
  if (choice?.kind === "formula" && choice.expression.trim() !== "") {
    return "Formula set. Apply runs it on the stack.";
  }
  return NO_CUSTOM_BAND_FUNCTION_SET_STATUS;
}

// The applied label and History record "Formula" or the tool's file name, the
// vocabulary stored by every project saved before CT-293.
export function describeCustomBandSelectionForAudit(choice: CustomBandSelection): string {
  if (choice.kind === "tool") return describeImportedToolBandSelection(choice.fileName);
  return FORMULA_BAND_SELECTION_DESCRIPTION;
}

export function describeImportedToolBandSelection(sourceName: string | undefined): string {
  return `Imported tool: ${sourceName ?? "script"}`;
}
