import { describe, expect, it } from "vitest";

import type { BundleAssetPartEncodingPlan } from "@/lib/image/encode-bundle-asset";

import type { DraftBundleFile, DraftBundleViewportEntry } from "./serialize-project";
import { splitDraftBundleForChunkedSave } from "./split-draft-bundle";

const RENDERING_STATE = {
  normalizationEnabled: false,
  selectedBandIndex: 0,
  lastAppliedOperationLabel: null,
};

function partPlanOf(extension: string, bytes: Uint8Array): BundleAssetPartEncodingPlan {
  return {
    extension,
    byteLength: bytes.byteLength,
    emitChunksInOrder: async (maxChunkBytes, onChunk) => {
      for (let offset = 0; offset < bytes.byteLength; offset += maxChunkBytes) {
        await onChunk(bytes.slice(offset, Math.min(offset + maxChunkBytes, bytes.byteLength)));
      }
    },
  };
}

function bakedEnviViewport(index: number): DraftBundleViewportEntry {
  return {
    index,
    fileName: `cube-${index}.hdr`,
    asset: {
      kind: "baked",
      primary: partPlanOf("hdr", Uint8Array.from([1, 2, 3])),
      sidecar: partPlanOf("bin", Uint8Array.from([4, 5, 6, 7])),
    },
    renderingState: RENDERING_STATE,
    operationHistory: [],
  };
}

function bakedTiffViewport(index: number): DraftBundleViewportEntry {
  return {
    index,
    fileName: `band-${index}.tif`,
    asset: { kind: "baked", primary: partPlanOf("tif", Uint8Array.from([9, 9])) },
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
  it("describes baked assets as byte-length descriptors and collects their plans as parts", () => {
    const split = splitDraftBundleForChunkedSave(
      draftOf([bakedEnviViewport(0), externalViewport(1), bakedTiffViewport(2)]),
    );
    expect(split.header.viewports[0]?.asset).toEqual({
      kind: "baked",
      primary: { extension: "hdr", byteLength: 3 },
      sidecar: { extension: "bin", byteLength: 4 },
    });
    expect(split.parts.map((part) => [part.viewportIndex, part.part, part.plan.byteLength])).toEqual([
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

  it("keeps the exact bytes reachable through the collected part plans", async () => {
    const split = splitDraftBundleForChunkedSave(draftOf([bakedEnviViewport(0)]));
    expect(Array.from(await emitAllBytes(split.parts[0]!.plan))).toEqual([1, 2, 3]);
    expect(Array.from(await emitAllBytes(split.parts[1]!.plan))).toEqual([4, 5, 6, 7]);
  });
});

async function emitAllBytes(plan: BundleAssetPartEncodingPlan): Promise<Uint8Array> {
  const collected = new Uint8Array(plan.byteLength);
  let offset = 0;
  await plan.emitChunksInOrder(2, async (bytes) => {
    collected.set(bytes, offset);
    offset += bytes.byteLength;
  });
  return collected;
}
