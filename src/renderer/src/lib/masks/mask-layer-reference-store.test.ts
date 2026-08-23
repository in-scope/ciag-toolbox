import { beforeEach, describe, expect, it } from "vitest";

import { createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";

import { readRememberedMaskLayerOrNull, syncRememberedMaskLayers } from "./mask-layer-reference-store";

function buildLayer(id: string): MaskLayer {
  return createMaskLayer(id, `Layer ${id}`, 2, 2);
}

describe("mask layer reference store", () => {
  beforeEach(() => {
    syncRememberedMaskLayers([]);
  });

  it("resolves a layer that was synced in", () => {
    const layer = buildLayer("mask-1");
    syncRememberedMaskLayers([layer]);
    expect(readRememberedMaskLayerOrNull("mask-1")).toBe(layer);
  });

  it("returns null for a layer id that was never synced", () => {
    expect(readRememberedMaskLayerOrNull("mask-missing")).toBeNull();
  });

  it("replaces the whole set on each sync rather than accumulating", () => {
    syncRememberedMaskLayers([buildLayer("mask-1")]);
    syncRememberedMaskLayers([buildLayer("mask-2")]);
    expect(readRememberedMaskLayerOrNull("mask-1")).toBeNull();
    expect(readRememberedMaskLayerOrNull("mask-2")).not.toBeNull();
  });
});
