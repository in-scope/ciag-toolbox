import { describe, expect, it } from "vitest";

import { resolveToneCurveApplyScopeOptions } from "./tone-curve-scope";

describe("resolveToneCurveApplyScopeOptions (CT-192)", () => {
  it("offers Full image, Whole stack and Region of interest for a multi-band stack", () => {
    const options = resolveToneCurveApplyScopeOptions(3);
    expect(options.map((option) => option.scope)).toEqual(["whole-image", "whole-stack", "roi"]);
    expect(options.map((option) => option.label)).toEqual([
      "Full image",
      "Whole stack",
      "Region of interest",
    ]);
  });

  it("drops Whole stack for a single-band stack (it would coincide with Full image)", () => {
    const options = resolveToneCurveApplyScopeOptions(1);
    expect(options.map((option) => option.scope)).toEqual(["whole-image", "roi"]);
    expect(options.some((option) => option.scope === "whole-stack")).toBe(false);
  });

  it("keeps Whole stack when the band count is unknown (null), never hiding a needed control", () => {
    const options = resolveToneCurveApplyScopeOptions(null);
    expect(options.some((option) => option.scope === "whole-stack")).toBe(true);
  });
});
