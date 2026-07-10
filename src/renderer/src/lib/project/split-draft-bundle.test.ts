import { describe, expect, it } from "vitest";

import type { DraftBundleFile, DraftBundleViewportEntry } from "./serialize-project";
import { splitDraftBundleForChunkedSave } from "./split-draft-bundle";

const RENDERING_STATE = {
  normalizationEnabled: false,
  selectedBandIndex: 0,
  lastAppliedOperationLabel: null,
};

function bakedEnviViewport(index: number): DraftBundleViewportEntry {
  return {
    index,
    fileName: `cube-${index}.hdr`,
    asset: {
      kind: "baked",
      bytes: Uint8Array.from([1, 2, 3]),
      extension: "hdr",
      sidecar: { extension: "bin", bytes: Uint8Array.from([4, 5, 6, 7]) },
    },
    renderingState: RENDERING_STATE,
    operationHistory: [],
  };
}

function bakedTiffViewport(index: number): DraftBundleViewportEntry {
  return {
    index,
    fileName: `band-${index}.tif`,
    asset: { kind: "baked", bytes: Uint8Array.from([9, 9]), extension: "tif" },
    renderingState: RENDERING_STATE,
    operationHistory: [],
    colorInterpretation: "rgb",
  };
}

function externalViewport(index: number): DraftBundleViewportEntry {
  return {
    index,
    fileName: `photo-${index}.png`,
    asset: { kind: "external", absolutePath: `/abs/photo-${index}.png`, extension: "png" },
    renderingState: RENDERING_STATE,
    operationHistory: [],
  };
}

function draftOf(viewports: ReadonlyArray<DraftBundleViewportEntry>): DraftBundleFile {
  return {
    formatVersion: 2,
    gridLayout: "2x2",
    selectedViewportIndices: [0, 2],
    viewports,
  };
}

describe("splitDraftBundleForChunkedSave", () => {
  it("describes baked assets as byte-length descriptors and collects their bytes as parts", () => {
    const split = splitDraftBundleForChunkedSave(
      draftOf([bakedEnviViewport(0), externalViewport(1), bakedTiffViewport(2)]),
    );
    expect(split.header.viewports[0]?.asset).toEqual({
      kind: "baked",
      primary: { extension: "hdr", byteLength: 3 },
      sidecar: { extension: "bin", byteLength: 4 },
    });
    expect(split.parts.map((part) => [part.viewportIndex, part.part, part.bytes.byteLength])).toEqual([
      [0, "primary", 3],
      [0, "sidecar", 4],
      [2, "primary", 2],
    ]);
  });

  it("passes external assets through untouched and carries top-level draft fields", () => {
    const split = splitDraftBundleForChunkedSave(draftOf([externalViewport(1)]));
    expect(split.header.viewports[0]?.asset).toEqual({
      kind: "external",
      absolutePath: "/abs/photo-1.png",
      extension: "png",
    });
    expect(split.parts).toEqual([]);
    expect(split.header.formatVersion).toBe(2);
    expect(split.header.gridLayout).toBe("2x2");
    expect(split.header.selectedViewportIndices).toEqual([0, 2]);
  });

  it("carries the rgb colour interpretation and omits it when absent", () => {
    const split = splitDraftBundleForChunkedSave(
      draftOf([bakedTiffViewport(0), bakedEnviViewport(1)]),
    );
    expect(split.header.viewports[0]?.colorInterpretation).toBe("rgb");
    expect(split.header.viewports[1]).not.toHaveProperty("colorInterpretation");
  });

  it("keeps the exact byte contents in the collected parts", () => {
    const split = splitDraftBundleForChunkedSave(draftOf([bakedEnviViewport(0)]));
    expect(Array.from(split.parts[0]!.bytes)).toEqual([1, 2, 3]);
    expect(Array.from(split.parts[1]!.bytes)).toEqual([4, 5, 6, 7]);
  });
});
