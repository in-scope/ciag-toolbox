import { describe, expect, it } from "vitest";

import {
  buildBandSelectionChoiceForMode,
  buildFormulaBandSelectionState,
  buildImportedToolBandSelectionState,
  describeCustomBandSelectionForAudit,
  describeImportedToolBandSelection,
  formatBandSelectionCustomInputStatus,
  isCustomBandSelection,
  NO_CUSTOM_BAND_FUNCTION_SET_STATUS,
  readBandSelectionFormulaText,
  readBandSelectionFunctionMode,
} from "./band-selection-editing";

const AVERAGE_PRESET = { kind: "preset", preset: "average" } as const;
const IMPORTED_TOOL = buildImportedToolBandSelectionState("C:/tools/band-tool.py", "band-tool.py");

describe("readBandSelectionFunctionMode", () => {
  it("maps each preset to its own segment", () => {
    expect(readBandSelectionFunctionMode(AVERAGE_PRESET)).toBe("average");
    expect(readBandSelectionFunctionMode({ kind: "preset", preset: "variance" })).toBe("variance");
  });

  it("maps a formula and an imported tool to the single Custom segment", () => {
    expect(readBandSelectionFunctionMode(buildFormulaBandSelectionState("cube[1]"))).toBe("custom");
    expect(readBandSelectionFunctionMode(IMPORTED_TOOL)).toBe("custom");
  });

  it("falls back to the default preset before the editor stages a choice", () => {
    expect(readBandSelectionFunctionMode(null)).toBe("average");
  });
});

describe("buildBandSelectionChoiceForMode", () => {
  it("replaces any custom configuration when a preset is chosen", () => {
    expect(buildBandSelectionChoiceForMode("variance", IMPORTED_TOOL)).toEqual({
      kind: "preset",
      preset: "variance",
    });
  });

  it("stages an empty formula when Custom is chosen from a preset", () => {
    expect(buildBandSelectionChoiceForMode("custom", AVERAGE_PRESET)).toEqual({
      kind: "formula",
      expression: "",
    });
  });

  it("keeps the existing custom configuration when Custom is re-chosen", () => {
    expect(buildBandSelectionChoiceForMode("custom", IMPORTED_TOOL)).toBe(IMPORTED_TOOL);
  });
});

describe("isCustomBandSelection", () => {
  it("is true only for a formula or an imported tool", () => {
    expect(isCustomBandSelection(buildFormulaBandSelectionState(""))).toBe(true);
    expect(isCustomBandSelection(IMPORTED_TOOL)).toBe(true);
    expect(isCustomBandSelection(AVERAGE_PRESET)).toBe(false);
    expect(isCustomBandSelection(null)).toBe(false);
  });
});

describe("readBandSelectionFormulaText", () => {
  it("reads the staged expression and blanks the field for every other choice", () => {
    expect(readBandSelectionFormulaText(buildFormulaBandSelectionState("cube[1]"))).toBe("cube[1]");
    expect(readBandSelectionFormulaText(IMPORTED_TOOL)).toBe("");
    expect(readBandSelectionFormulaText(AVERAGE_PRESET)).toBe("");
    expect(readBandSelectionFormulaText(null)).toBe("");
  });
});

describe("formatBandSelectionCustomInputStatus", () => {
  it("names the loaded tool", () => {
    expect(formatBandSelectionCustomInputStatus(IMPORTED_TOOL)).toBe(
      "Tool loaded: band-tool.py. Apply runs it on the stack.",
    );
  });

  it("says a formula will run at Apply", () => {
    expect(formatBandSelectionCustomInputStatus(buildFormulaBandSelectionState("cube[1]"))).toBe(
      "Formula set. Apply runs it on the stack.",
    );
  });

  it("asks for an input while the formula is blank", () => {
    expect(formatBandSelectionCustomInputStatus(buildFormulaBandSelectionState("  "))).toBe(
      NO_CUSTOM_BAND_FUNCTION_SET_STATUS,
    );
  });
});

describe("describeCustomBandSelectionForAudit", () => {
  it("keeps the pre-CT-293 History vocabulary", () => {
    expect(describeCustomBandSelectionForAudit(buildFormulaBandSelectionState("cube[1]"))).toBe("Formula");
    expect(describeCustomBandSelectionForAudit(IMPORTED_TOOL)).toBe("Imported tool: band-tool.py");
  });
});

describe("describeImportedToolBandSelection", () => {
  it("names the imported file", () => {
    expect(describeImportedToolBandSelection("band-tool.py")).toBe("Imported tool: band-tool.py");
  });

  it("falls back to a generic name when none is provided", () => {
    expect(describeImportedToolBandSelection(undefined)).toBe("Imported tool: script");
  });
});
