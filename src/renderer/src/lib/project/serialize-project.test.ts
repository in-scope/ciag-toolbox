import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import { PROJECT_FILE_FORMAT_VERSION } from "./project-schema";
import {
  buildDraftBundleFromSnapshot,
  saveableSnapshotRequiresRasterRebake,
  type SaveableProjectSnapshot,
} from "./serialize-project";

describe("buildDraftBundleFromSnapshot", () => {
  it("emits the supported format version constant", () => {
    const draft = buildDraftBundleFromSnapshot(buildSingleViewportSnapshot());
    expect(draft.formatVersion).toBe(PROJECT_FILE_FORMAT_VERSION);
  });

  it("bakes a modified raster source as a single-band TIFF asset", () => {
    const draft = buildDraftBundleFromSnapshot(withAppliedOperation(buildSingleViewportSnapshot()));
    const [first] = draft.viewports;
    expect(first?.asset.kind).toBe("baked");
    if (first?.asset.kind !== "baked") return;
    expect(first.asset.extension).toBe("tif");
    expect(first.asset.sidecar).toBeUndefined();
    expect(first.asset.bytes.byteLength).toBeGreaterThan(0);
  });

  it("bakes a modified multi-band raster source as an ENVI asset with a .bin sidecar", () => {
    const draft = buildDraftBundleFromSnapshot(withAppliedOperation(buildMultiBandRasterSnapshot()));
    const [first] = draft.viewports;
    expect(first?.asset.kind).toBe("baked");
    if (first?.asset.kind !== "baked") return;
    expect(first.asset.extension).toBe("hdr");
    expect(first.asset.sidecar?.extension).toBe("bin");
    expect(first.asset.sidecar?.bytes.byteLength).toBeGreaterThan(0);
  });

  it("references an unmodified on-disk raster as an external asset instead of baking it", () => {
    const draft = buildDraftBundleFromSnapshot(buildMultiBandRasterSnapshot());
    const [first] = draft.viewports;
    expect(first?.asset.kind).toBe("external");
    if (first?.asset.kind !== "external") return;
    expect(first.asset.absolutePath).toBe("/abs/path/to/cube.hdr");
    expect(first.asset.extension).toBe("hdr");
  });

  // CT-061: a large unmodified ENVI cube must never be re-encoded into renderer
  // memory or cloned across IPC. The external path declares the source by path
  // and reads no pixels, so a cube with huge declared dimensions packs without
  // allocating anything.
  it("streams a large unmodified ENVI cube by reference without baking it", () => {
    const snapshot = buildLargeUnmodifiedEnviSnapshot();
    const draft = buildDraftBundleFromSnapshot(snapshot);
    expect(draft.viewports[0]?.asset.kind).toBe("external");
  });

  it("rejects baking a modified raster that exceeds the bundle bake size limit", () => {
    const snapshot = withAppliedOperation(buildLargeUnmodifiedEnviSnapshot());
    expect(() => buildDraftBundleFromSnapshot(snapshot)).toThrow(/too large/i);
  });

  it("sorts the selected viewport indices ascending", () => {
    const snapshot: SaveableProjectSnapshot = {
      ...buildSingleViewportSnapshot(),
      selectedViewportIndices: [3, 1, 2],
    };
    const draft = buildDraftBundleFromSnapshot(snapshot);
    expect(draft.selectedViewportIndices).toEqual([1, 2, 3]);
  });

  it("forwards rendering state values onto each viewport entry", () => {
    const draft = buildDraftBundleFromSnapshot(buildSingleViewportSnapshot());
    const [first] = draft.viewports;
    expect(first?.renderingState.normalizationEnabled).toBe(true);
    expect(first?.renderingState.selectedBandIndex).toBe(0);
    expect(first?.renderingState.lastAppliedOperationLabel).toBeNull();
  });

  it("forwards each viewport's operationHistory entries unchanged", () => {
    const snapshot: SaveableProjectSnapshot = {
      ...buildSingleViewportSnapshot(),
      viewports: [
        {
          ...buildSingleViewportSnapshot().viewports[0]!,
          operationHistory: [
            {
              actionId: "bit-shift",
              actionLabel: "Bit Shift",
              appliedLabel: "Bit shift +4",
              parameterValues: { shiftAmount: 4 },
              timestampMs: 1_700_000_000_000,
            },
          ],
        },
      ],
    };
    const draft = buildDraftBundleFromSnapshot(snapshot);
    expect(draft.viewports[0]?.operationHistory).toHaveLength(1);
    expect(draft.viewports[0]?.operationHistory[0]?.actionId).toBe("bit-shift");
    expect(draft.viewports[0]?.operationHistory[0]?.parameterValues).toEqual({ shiftAmount: 4 });
  });
});

// CT-072: the save flow waits for the busy indicator to paint before the heavy
// raster bake, but only when a bake will actually happen. An all-external save
// must report no rebake so it stays fast and flash-free.
describe("saveableSnapshotRequiresRasterRebake", () => {
  it("reports a rebake when a modified raster source must be re-encoded", () => {
    const snapshot = withAppliedOperation(buildSingleViewportSnapshot());
    expect(saveableSnapshotRequiresRasterRebake(snapshot)).toBe(true);
  });

  it("reports no rebake for an unmodified on-disk raster streamed by reference", () => {
    expect(saveableSnapshotRequiresRasterRebake(buildMultiBandRasterSnapshot())).toBe(false);
  });

  it("reports no rebake for a large unmodified ENVI cube streamed by reference", () => {
    expect(saveableSnapshotRequiresRasterRebake(buildLargeUnmodifiedEnviSnapshot())).toBe(false);
  });

  it("reports a rebake when any viewport in a multi-viewport save was modified", () => {
    const unmodified = buildSingleViewportSnapshot().viewports[0]!;
    const modified = withAppliedOperation(buildMultiBandRasterSnapshot()).viewports[0]!;
    const snapshot: SaveableProjectSnapshot = {
      ...buildSingleViewportSnapshot(),
      viewports: [unmodified, { ...modified, index: 1 }],
    };
    expect(saveableSnapshotRequiresRasterRebake(snapshot)).toBe(true);
  });
});

function buildSingleViewportSnapshot(): SaveableProjectSnapshot {
  return {
    gridLayout: "1x1",
    selectedViewportIndices: [0],
    viewports: [
      {
        index: 0,
        fileName: "sample.tif",
        source: buildSingleBandRasterSource(),
        originalFilePath: "/abs/path/to/sample.tif",
        renderingState: {
          normalizationEnabled: true,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: null,
        },
        operationHistory: [],
      },
    ],
  };
}

function buildMultiBandRasterSnapshot(): SaveableProjectSnapshot {
  return {
    gridLayout: "1x1",
    selectedViewportIndices: [0],
    viewports: [
      {
        index: 0,
        fileName: "cube.hdr",
        source: buildMultiBandRasterSource(),
        originalFilePath: "/abs/path/to/cube.hdr",
        renderingState: {
          normalizationEnabled: false,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: null,
        },
        operationHistory: [],
      },
    ],
  };
}

function withAppliedOperation(
  snapshot: SaveableProjectSnapshot,
): SaveableProjectSnapshot {
  return {
    ...snapshot,
    viewports: snapshot.viewports.map((viewport) => ({
      ...viewport,
      operationHistory: [
        {
          actionId: "bit-shift",
          actionLabel: "Bit Shift",
          appliedLabel: "Bit shift +4",
          parameterValues: { shiftAmount: 4 },
          timestampMs: 1_700_000_000_000,
        },
      ],
    })),
  };
}

function buildLargeUnmodifiedEnviSnapshot(): SaveableProjectSnapshot {
  const base = buildMultiBandRasterSnapshot();
  const viewport = base.viewports[0]!;
  const source = viewport.source as Extract<ViewportImageSource, { kind: "raster" }>;
  return {
    ...base,
    viewports: [
      {
        ...viewport,
        source: { kind: "raster", raster: { ...source.raster, width: 20_000, height: 20_000, bandCount: 10 } },
      },
    ],
  };
}

function buildSingleBandRasterSource(): ViewportImageSource {
  const raster: RasterImage = {
    bandPixels: [new Uint16Array([0, 1, 2, 3])],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
  return { kind: "raster", raster };
}

function buildMultiBandRasterSource(): ViewportImageSource {
  const raster: RasterImage = {
    bandPixels: [
      new Uint16Array([0, 1, 2, 3]),
      new Uint16Array([4, 5, 6, 7]),
      new Uint16Array([8, 9, 10, 11]),
    ],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 3,
    sourceInterleave: "bil",
  };
  return { kind: "raster", raster };
}
