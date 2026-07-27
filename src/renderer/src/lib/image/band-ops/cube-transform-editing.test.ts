import { describe, expect, it } from "vitest";

import {
  buildFormulaCubeTransformState,
  buildImportedToolCubeTransformState,
  describeCubeTransformForAudit,
  describeCubeTransformRunError,
  formatCubeTransformStatusLine,
  NO_CUBE_TRANSFORM_SET_STATUS,
} from "./cube-transform-editing";
import { SCRIPTING_DOCS_HINT, UserScriptReturnContractError } from "./user-script-return-contract";

describe("cube transform editing state builders", () => {
  it("builds a formula state carrying the raw expression text", () => {
    const state = buildFormulaCubeTransformState("cube * 2");
    expect(state).toEqual({ kind: "formula", expression: "cube * 2" });
  });

  it("treats a blank expression as no configured transform", () => {
    expect(buildFormulaCubeTransformState("")).toBeNull();
    expect(buildFormulaCubeTransformState("   ")).toBeNull();
  });

  it("builds a tool state carrying the file path and name", () => {
    const state = buildImportedToolCubeTransformState("C:/tools/transform-tool.py", "transform-tool.py");
    expect(state).toEqual({
      kind: "tool",
      filePath: "C:/tools/transform-tool.py",
      fileName: "transform-tool.py",
    });
  });
});

describe("formatCubeTransformStatusLine", () => {
  it("reports nothing set when the state is absent", () => {
    expect(formatCubeTransformStatusLine(null)).toBe(NO_CUBE_TRANSFORM_SET_STATUS);
  });

  it("points at Apply for a configured formula", () => {
    expect(formatCubeTransformStatusLine(buildFormulaCubeTransformState("cube * 2"))).toBe(
      "Formula set. Apply runs it on the stack.",
    );
  });

  it("names the loaded tool and points at Apply", () => {
    const state = buildImportedToolCubeTransformState("C:/tools/transform-tool.py", "transform-tool.py");
    expect(formatCubeTransformStatusLine(state)).toBe(
      "Tool loaded: transform-tool.py. Apply runs it on the stack.",
    );
  });
});

describe("describeCubeTransformForAudit", () => {
  it("records the trimmed formula expression", () => {
    expect(describeCubeTransformForAudit(buildFormulaCubeTransformState(" cube * 2 ")!)).toBe("cube * 2");
  });

  it("records the imported tool's file name", () => {
    const state = buildImportedToolCubeTransformState("C:/tools/transform-tool.py", "transform-tool.py");
    expect(describeCubeTransformForAudit(state)).toBe("transform-tool.py");
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
