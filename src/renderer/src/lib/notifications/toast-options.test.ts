import { describe, expect, it } from "vitest";

import { buildErrorToastOptions, buildSuccessToastOptions } from "./toast-options";

describe("buildErrorToastOptions", () => {
  it("never auto-dismisses: the duration is infinite", () => {
    expect(buildErrorToastOptions().duration).toBe(Number.POSITIVE_INFINITY);
  });

  it("shows a close button", () => {
    expect(buildErrorToastOptions().closeButton).toBe(true);
  });

  it("accepts pointer events despite the Toaster-wide pointer transparency", () => {
    expect(buildErrorToastOptions().style).toEqual({ pointerEvents: "auto" });
  });
});

describe("buildSuccessToastOptions", () => {
  it("keeps the transient defaults: no duration, close button, or style overrides", () => {
    expect(buildSuccessToastOptions()).toEqual({});
  });
});
