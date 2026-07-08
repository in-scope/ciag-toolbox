import { describe, expect, it } from "vitest";

import {
  buildFormulaCubeTransformState,
  buildImportedToolCubeTransformState,
  describeCubeTransformRunError,
  formatCubeTransformStatusLine,
  NO_CUBE_TRANSFORM_READY_STATUS,
} from "./cube-transform-editing";
import { SCRIPTING_DOCS_HINT, UserScriptReturnContractError } from "./user-script-return-contract";

describe("cube transform editing state builders", () => {
  it("labels a formula run 'Formula' and records the expression for the audit trail", () => {
    const state = buildFormulaCubeTransformState("cube-transform-0", 3, "cube * 2");
    expect(state.sourceLabel).toBe("Formula");
    expect(state.auditDescription).toBe("cube * 2");
    expect(state.token).toBe("cube-transform-0");
    expect(state.outputBandCount).toBe(3);
  });

  it("labels an imported tool by its file name and records that name for the audit trail", () => {
    const state = buildImportedToolCubeTransformState("cube-transform-1", 2, "transform-tool.py");
    expect(state.sourceLabel).toBe("Imported tool: transform-tool.py");
    expect(state.auditDescription).toBe("transform-tool.py");
  });

  it("falls back to a generic tool name when the import carries no source name", () => {
    const state = buildImportedToolCubeTransformState("cube-transform-2", 2, undefined);
    expect(state.sourceLabel).toBe("Imported tool: script");
    expect(state.auditDescription).toBe("script");
  });
});

describe("formatCubeTransformStatusLine", () => {
  it("reports no ready transform when the state is absent", () => {
    expect(formatCubeTransformStatusLine(null)).toBe(NO_CUBE_TRANSFORM_READY_STATUS);
  });

  it("names the ready formula transform including the output band count", () => {
    const state = buildFormulaCubeTransformState("t", 3, "cube * 2");
    expect(formatCubeTransformStatusLine(state)).toBe("Transform ready: Formula (3 bands)");
  });

  it("uses the singular band wording for a single-band output", () => {
    const state = buildFormulaCubeTransformState("t", 1, "cube[:1]");
    expect(formatCubeTransformStatusLine(state)).toBe("Transform ready: Formula (1 band)");
  });

  it("names the ready imported-tool transform including the output band count", () => {
    const state = buildImportedToolCubeTransformState("t", 3, "transform-tool.py");
    expect(formatCubeTransformStatusLine(state)).toBe(
      "Transform ready: Imported tool: transform-tool.py (3 bands)",
    );
  });
});

describe("describeCubeTransformRunError", () => {
  it("appends the docs hint to a worker failure message that lacks it", () => {
    const text = describeCubeTransformRunError(new Error("The script failed: boom"));
    expect(text).toBe(`The script failed: boom ${SCRIPTING_DOCS_HINT}`);
  });

  it("keeps a contract error's message unchanged (it already ends with the hint)", () => {
    const error = new UserScriptReturnContractError("The transformed cube must have at least one band (got 0).");
    expect(describeCubeTransformRunError(error)).toBe(error.message);
    expect(describeCubeTransformRunError(error).endsWith(SCRIPTING_DOCS_HINT)).toBe(true);
  });

  it("stringifies a non-Error failure and still ends with the docs hint", () => {
    expect(describeCubeTransformRunError("boom")).toBe(`boom ${SCRIPTING_DOCS_HINT}`);
  });
});
