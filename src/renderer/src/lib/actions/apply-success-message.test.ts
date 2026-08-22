import { describe, expect, it } from "vitest";

import { composeApplySuccessMessage } from "./apply-success-message";

const CROP_LIKE_ACTION = {
  successMessage: "Crop to region applied",
  successHintWhenResultOpensNewPanel: "Closing the original panel frees its memory.",
};

const HINTLESS_ACTION = { successMessage: "Invert applied" };

describe("composeApplySuccessMessage", () => {
  it("appends the hint when the result opened in a new panel", () => {
    expect(composeApplySuccessMessage(CROP_LIKE_ACTION, true)).toBe(
      "Crop to region applied. Closing the original panel frees its memory.",
    );
  });

  it("omits the hint for an in-place apply", () => {
    expect(composeApplySuccessMessage(CROP_LIKE_ACTION, false)).toBe("Crop to region applied");
  });

  it("leaves actions without a hint unchanged on the new-panel path", () => {
    expect(composeApplySuccessMessage(HINTLESS_ACTION, true)).toBe("Invert applied");
  });
});
