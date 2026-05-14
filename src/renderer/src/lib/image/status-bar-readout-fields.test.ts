import { describe, expect, it } from "vitest";

import { buildStatusBarReadoutFieldsFromSnapshot } from "./status-bar-readout-fields";
import type { ViewportPixelReadoutBands } from "./compute-pixel-readout";
import type { ViewportPixelReadoutSnapshot } from "@/state/pixel-readout-context";

function buildSnapshotWithFields(
  overrides: Partial<ViewportPixelReadoutSnapshot> = {},
): ViewportPixelReadoutSnapshot {
  return {
    viewportNumber: 2,
    imagePixelX: 17,
    imagePixelY: 42,
    selectedBandIndex: 1,
    bands: null,
    bandCount: 0,
    ...overrides,
  };
}

function buildBandsForActiveValueOf(
  values: ReadonlyArray<number>,
  labels: ReadonlyArray<string>,
): ViewportPixelReadoutBands {
  return { values, labels, sampleFormat: "uint" };
}

describe("buildStatusBarReadoutFieldsFromSnapshot", () => {
  it("renders viewport, X, Y, active band label, and active band value as the only fields", () => {
    const snapshot = buildSnapshotWithFields({
      bands: buildBandsForActiveValueOf([10, 20, 30], ["B1", "B2", "B3"]),
    });
    const fields = buildStatusBarReadoutFieldsFromSnapshot(snapshot);
    expect(fields).toEqual({
      viewportNumber: "2",
      imagePixelX: "17",
      imagePixelY: "42",
      activeBandLabel: "B2",
      activeBandValue: "20",
    });
    expect(Object.keys(fields).sort()).toEqual([
      "activeBandLabel",
      "activeBandValue",
      "imagePixelX",
      "imagePixelY",
      "viewportNumber",
    ]);
  });

  it("returns null active band label when the snapshot carries no bands", () => {
    const snapshot = buildSnapshotWithFields();
    const fields = buildStatusBarReadoutFieldsFromSnapshot(snapshot);
    expect(fields.activeBandLabel).toBeNull();
    expect(fields.activeBandValue).toBe("-");
  });

  it("returns the placeholder dash when the active band index is out of bounds", () => {
    const snapshot = buildSnapshotWithFields({
      selectedBandIndex: 5,
      bands: buildBandsForActiveValueOf([10, 20], ["B1", "B2"]),
    });
    const fields = buildStatusBarReadoutFieldsFromSnapshot(snapshot);
    expect(fields.activeBandValue).toBe("-");
    expect(fields.activeBandLabel).toBeNull();
  });

  it("formats float-format active band values to four significant figures", () => {
    const snapshot = buildSnapshotWithFields({
      selectedBandIndex: 0,
      bands: { values: [0.123456], labels: ["F1"], sampleFormat: "float" },
    });
    expect(buildStatusBarReadoutFieldsFromSnapshot(snapshot).activeBandValue).toBe("0.1235");
  });
});
