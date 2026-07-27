import { describe, expect, it } from "vitest";

import { resolveToneCurveApplyScopeOptions } from "./tone-curve-scope";

describe("resolveToneCurveApplyScopeOptions (CT-192 / CT-244)", () => {
  it("offers exactly Full image and Whole stack for a multi-band stack (no Region of interest)", () => {
    const options = resolveToneCurveApplyScopeOptions(3, false);
    expect(options.map((option) => option.scope)).toEqual(["whole-image", "whole-stack"]);
    expect(options.map((option) => option.label)).toEqual(["Full image", "Whole stack"]);
  });

  it("offers only Full image for a single-band stack, so the scope control hides", () => {
    const options = resolveToneCurveApplyScopeOptions(1, false);
    expect(options.map((option) => option.scope)).toEqual(["whole-image"]);
  });

  it("offers only Full image for a true-colour photo, so the scope control hides", () => {
    const options = resolveToneCurveApplyScopeOptions(3, true);
    expect(options.map((option) => option.scope)).toEqual(["whole-image"]);
  });

  it("keeps Whole stack when the band count is unknown (null), never hiding a needed control", () => {
    const options = resolveToneCurveApplyScopeOptions(null, false);
    expect(options.some((option) => option.scope === "whole-stack")).toBe(true);
  });
});
