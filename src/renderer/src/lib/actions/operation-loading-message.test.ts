import { describe, expect, it } from "vitest";

import {
  describeOperationLoadingMessage,
  shouldShowOperationLoadingImmediately,
} from "./operation-loading-message";

describe("describeOperationLoadingMessage", () => {
  it("uses the action's explicit loading message when present", () => {
    expect(
      describeOperationLoadingMessage({ label: "Normalize", loadingMessage: "Normalizing..." }),
    ).toBe("Normalizing...");
  });

  it("uses the operation-specific reflectance message for calibration", () => {
    expect(
      describeOperationLoadingMessage({
        label: "Spectralon Calibration",
        loadingMessage: "Calibrating reflectance...",
      }),
    ).toBe("Calibrating reflectance...");
  });

  it("falls back to a label-driven message when none is specified", () => {
    expect(describeOperationLoadingMessage({ label: "Tone Curve" })).toBe("Applying Tone Curve...");
  });
});

describe("shouldShowOperationLoadingImmediately", () => {
  it("shows the loading state immediately for a new, empty result panel", () => {
    expect(shouldShowOperationLoadingImmediately({ opensInNewEmptyPanel: true })).toBe(true);
  });

  it("defers to the anti-flash delay for in-place operations", () => {
    expect(shouldShowOperationLoadingImmediately({ opensInNewEmptyPanel: false })).toBe(false);
  });
});
