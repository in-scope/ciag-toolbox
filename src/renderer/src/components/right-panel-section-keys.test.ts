import { describe, expect, it } from "vitest";

import {
  listVisibleRightPanelSectionKeys,
  type RightPanelSectionVisibility,
} from "@/components/right-panel-section-keys";

function buildVisibilityWithEverythingVisible(): RightPanelSectionVisibility {
  return {
    hasActiveSource: true,
    showSubsetBandsEditor: false,
    showHistogram: true,
    showSpectra: true,
    showRegion: true,
    showHistory: true,
  };
}

describe("listVisibleRightPanelSectionKeys (CT-092)", () => {
  it("keeps the decluttered order Metadata, Histogram, Spectra, Region, History", () => {
    const keys = listVisibleRightPanelSectionKeys(buildVisibilityWithEverythingVisible());
    expect(keys).toEqual(["metadata", "histogram", "spectra", "region", "history"]);
  });

  it("never lists a Bands or Pixel Inspector section", () => {
    const keys = listVisibleRightPanelSectionKeys(buildVisibilityWithEverythingVisible());
    expect(keys).not.toContain("bands");
    expect(keys).not.toContain("pixel-inspector");
  });

  it("omits sections whose own visibility predicate is false", () => {
    const keys = listVisibleRightPanelSectionKeys({
      hasActiveSource: true,
      showSubsetBandsEditor: false,
      showHistogram: false,
      showSpectra: true,
      showRegion: false,
      showHistory: true,
    });
    expect(keys).toEqual(["metadata", "spectra", "history"]);
  });

  it("returns nothing when there is no active source", () => {
    const keys = listVisibleRightPanelSectionKeys({
      hasActiveSource: false,
      showSubsetBandsEditor: false,
      showHistogram: false,
      showSpectra: false,
      showRegion: false,
      showHistory: false,
    });
    expect(keys).toEqual([]);
  });

  it("slots the transient Subset Bands editor right after Metadata when active", () => {
    const keys = listVisibleRightPanelSectionKeys({
      ...buildVisibilityWithEverythingVisible(),
      showSubsetBandsEditor: true,
    });
    expect(keys).toEqual([
      "metadata",
      "subset-bands",
      "histogram",
      "spectra",
      "region",
      "history",
    ]);
  });
});
