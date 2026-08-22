import { describe, expect, it } from "vitest";

import {
  openInNewViewportFromResultDestination,
  resultDestinationFromOpenInNewViewport,
} from "./result-destination";

describe("result destination mapping (CT-291)", () => {
  it("maps openInNewViewport true to the new-panel segment", () => {
    expect(resultDestinationFromOpenInNewViewport(true)).toBe("new-panel");
  });

  it("maps openInNewViewport false to the replace-current-panel segment", () => {
    expect(resultDestinationFromOpenInNewViewport(false)).toBe("replace-current-panel");
  });

  it("maps the new-panel segment back to true", () => {
    expect(openInNewViewportFromResultDestination("new-panel")).toBe(true);
  });

  it("maps the replace-current-panel segment back to false", () => {
    expect(openInNewViewportFromResultDestination("replace-current-panel")).toBe(false);
  });

  it("round-trips both directions", () => {
    for (const openInNewViewport of [true, false]) {
      const destination = resultDestinationFromOpenInNewViewport(openInNewViewport);
      expect(openInNewViewportFromResultDestination(destination)).toBe(openInNewViewport);
    }
  });
});
