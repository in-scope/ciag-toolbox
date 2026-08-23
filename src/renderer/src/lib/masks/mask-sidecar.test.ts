import { describe, expect, it } from "vitest";

import { createMaskLayer, setMaskLayerOpacityPercent, type MaskLayer } from "@/lib/masks/mask-layer";
import {
  buildMaskSidecarDocument,
  parseMaskSidecarDocumentOrNull,
  serializeMaskSidecarDocument,
} from "@/lib/masks/mask-sidecar";

// CT-303: the sidecar names and colours the category indexes the PNG stores.
// It must survive a serialize/parse round trip, and any malformed sidecar must
// read as ABSENT so the import falls back to defaults instead of failing.

function buildLayerForSidecar(): MaskLayer {
  return setMaskLayerOpacityPercent(createMaskLayer("mask-1", "Parchment mask", 4, 3), 60);
}

describe("buildMaskSidecarDocument", () => {
  it("describes the layer with 1-based category indexes", () => {
    expect(buildMaskSidecarDocument(buildLayerForSidecar())).toEqual({
      formatVersion: 1,
      name: "Parchment mask",
      width: 4,
      height: 3,
      categories: [
        { index: 1, name: "Foreground", color: "#ef4444" },
        { index: 2, name: "Background", color: "#3b82f6" },
      ],
      opacity: 60,
    });
  });
});

describe("serializeMaskSidecarDocument", () => {
  it("round-trips through the parser", () => {
    const layer = buildLayerForSidecar();
    const parsed = parseMaskSidecarDocumentOrNull(serializeMaskSidecarDocument(layer));
    expect(parsed).toEqual(buildMaskSidecarDocument(layer));
  });
});

describe("parseMaskSidecarDocumentOrNull", () => {
  it("reads a hand-written sidecar", () => {
    const text = JSON.stringify({
      formatVersion: 1,
      name: "Ink",
      width: 8,
      height: 8,
      categories: [{ index: 1, name: "Ink", color: "#123456" }],
      opacity: 25,
    });
    expect(parseMaskSidecarDocumentOrNull(text)?.categories).toEqual([
      { index: 1, name: "Ink", color: "#123456" },
    ]);
  });

  it("reads as absent when the JSON is malformed", () => {
    expect(parseMaskSidecarDocumentOrNull("{not json")).toBeNull();
  });

  it("reads as absent when the format version is unknown", () => {
    const text = JSON.stringify({ formatVersion: 2, name: "Ink", categories: [] });
    expect(parseMaskSidecarDocumentOrNull(text)).toBeNull();
  });

  it("reads as absent when a category is missing its colour", () => {
    const text = JSON.stringify({
      formatVersion: 1,
      name: "Ink",
      width: 2,
      height: 2,
      categories: [{ index: 1, name: "Ink" }],
      opacity: 50,
    });
    expect(parseMaskSidecarDocumentOrNull(text)).toBeNull();
  });

  it("falls back to the default opacity when the field is not a number", () => {
    const text = JSON.stringify({
      formatVersion: 1,
      name: "Ink",
      width: 2,
      height: 2,
      categories: [{ index: 1, name: "Ink", color: "#ffffff" }],
      opacity: "half",
    });
    expect(parseMaskSidecarDocumentOrNull(text)?.opacity).toBe(50);
  });
});
