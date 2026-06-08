import { describe, expect, it } from "vitest";

import { REGISTERED_VIEWPORT_ACTIONS } from "./registered-actions";

describe("REGISTERED_VIEWPORT_ACTIONS", () => {
  it("does not register Normalized viewing as an audited operation (it is a view-only display aid)", () => {
    const registeredActionIds = REGISTERED_VIEWPORT_ACTIONS.map((action) => action.id);
    expect(registeredActionIds).not.toContain("normalize");
  });

  it("registers only the data-changing operations that belong in the audit trail", () => {
    const registeredActionIds = REGISTERED_VIEWPORT_ACTIONS.map((action) => action.id);
    expect(registeredActionIds).toEqual(["bit-shift", "crop-to-region"]);
  });
});
