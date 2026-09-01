import { describe, expect, it, vi } from "vitest";

import { buildMaskLayerZipEntries } from "@/lib/masks/mask-export-zip";
import { createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import { COMBINED_MASK_LAYER_NAME } from "@/lib/masks/mask-multi-file-import";
import { encodeMaskValuesAsGrayscalePngBytes } from "@/lib/masks/mask-png-encode";
import {
  buildMaskLayerContentFromZipEntries,
  findLosslessMaskZipPairOrNull,
  listMaskPngEntriesInNameOrder,
  ZIP_WITHOUT_MASK_PNGS_MESSAGE,
} from "@/lib/masks/mask-zip-import";
import type { ZipArchiveEntry } from "@/lib/masks/zip-store-reader";

// CT-328: a picked zip becomes one layer either LOSSLESSLY (the toolbox's own
// <name>.png + <name>.json pair, ignoring the per-category binaries beside
// them) or as one category per .png entry in name order.

const WIDTH = 4;
const HEIGHT = 2;

const acceptEveryMaskFile = (): void => undefined;

function buildTwoCategoryLayer(): MaskLayer {
  const layer = createMaskLayer("mask-1", "Parchment mask", WIDTH, HEIGHT);
  layer.values.set([0, 1, 1, 0, 2, 2, 0, 0]);
  return {
    ...layer,
    opacityPercent: 60,
    categories: [
      { ...layer.categories[0]!, name: "Parchment", color: "#111111" },
      { ...layer.categories[1]!, name: "Substrate", color: "#222222" },
    ],
  };
}

async function buildBinaryPngEntry(
  name: string,
  values: ReadonlyArray<number>,
): Promise<ZipArchiveEntry> {
  return {
    name,
    bytes: await encodeMaskValuesAsGrayscalePngBytes(WIDTH, HEIGHT, Uint8Array.from(values)),
  };
}

describe("findLosslessMaskZipPairOrNull", () => {
  it("finds the JSON sidecar whose stem also names a PNG", () => {
    const entries: ZipArchiveEntry[] = [
      { name: "Parchment.png", bytes: Uint8Array.of(0) },
      { name: "Parchment mask.png", bytes: Uint8Array.of(1) },
      { name: "Parchment mask.json", bytes: new TextEncoder().encode("{}") },
    ];

    expect(findLosslessMaskZipPairOrNull(entries)?.stem).toBe("Parchment mask");
  });

  it("reports no pair when a sidecar names no matching PNG", () => {
    const entries: ZipArchiveEntry[] = [
      { name: "class-a.png", bytes: Uint8Array.of(0) },
      { name: "notes.json", bytes: new TextEncoder().encode("{}") },
    ];

    expect(findLosslessMaskZipPairOrNull(entries)).toBeNull();
  });
});

describe("listMaskPngEntriesInNameOrder", () => {
  it("keeps only the PNG entries and sorts them by name", () => {
    const entries: ZipArchiveEntry[] = [
      { name: "second.png", bytes: Uint8Array.of(0) },
      { name: "readme.txt", bytes: Uint8Array.of(0) },
      { name: "first.PNG", bytes: Uint8Array.of(0) },
    ];

    expect(listMaskPngEntriesInNameOrder(entries).map((entry) => entry.name)).toEqual([
      "first.PNG",
      "second.png",
    ]);
  });
});

describe("buildMaskLayerContentFromZipEntries", () => {
  it("rebuilds an exported layer exactly from its index PNG and sidecar", async () => {
    const original = buildTwoCategoryLayer();
    const entries = await buildMaskLayerZipEntries(original);

    const content = await buildMaskLayerContentFromZipEntries(entries, acceptEveryMaskFile);

    expect(content.name).toBe(original.name);
    expect(content.opacityPercent).toBe(original.opacityPercent);
    expect(Array.from(content.values)).toEqual(Array.from(original.values));
    expect(content.categories.map((category) => category.name)).toEqual([
      "Parchment",
      "Substrate",
    ]);
    expect(content.categories.map((category) => category.color)).toEqual([
      "#111111",
      "#222222",
    ]);
  });

  it("reads a zip without a sidecar as one category per PNG entry", async () => {
    const entries = [
      await buildBinaryPngEntry("masks/text.png", [255, 255, 0, 0, 0, 0, 0, 0]),
      await buildBinaryPngEntry("masks/parchment.png", [0, 0, 0, 0, 255, 255, 0, 0]),
    ];

    const content = await buildMaskLayerContentFromZipEntries(entries, acceptEveryMaskFile);

    expect(content.name).toBe(COMBINED_MASK_LAYER_NAME);
    // "parchment" sorts before "text", so it takes category 1.
    expect(content.categories.map((category) => category.name)).toEqual(["parchment", "text"]);
    expect(Array.from(content.values)).toEqual([2, 2, 0, 0, 1, 1, 0, 0]);
  });

  it("refuses a zip holding no PNG at all", async () => {
    const entries: ZipArchiveEntry[] = [
      { name: "notes.txt", bytes: new TextEncoder().encode("nothing here") },
    ];

    await expect(
      buildMaskLayerContentFromZipEntries(entries, acceptEveryMaskFile),
    ).rejects.toThrow(ZIP_WITHOUT_MASK_PNGS_MESSAGE);
  });

  it("refuses on the first PNG entry that does not cover the stack", async () => {
    const entries = [
      await buildBinaryPngEntry("a.png", [255, 0, 0, 0, 0, 0, 0, 0]),
      await buildBinaryPngEntry("b.png", [0, 0, 0, 0, 255, 0, 0, 0]),
    ];
    const refuse = vi.fn((fileName: string) => {
      if (fileName === "b.png") throw new Error(`${fileName} does not cover the stack.`);
    });

    await expect(buildMaskLayerContentFromZipEntries(entries, refuse)).rejects.toThrow(
      "b.png does not cover the stack.",
    );
  });

  it("checks the index PNG against the stack on the lossless path", async () => {
    const entries = await buildMaskLayerZipEntries(buildTwoCategoryLayer());
    const refuse = vi.fn(() => {
      throw new Error("refused");
    });

    await expect(buildMaskLayerContentFromZipEntries(entries, refuse)).rejects.toThrow("refused");
    expect(refuse).toHaveBeenCalledWith("Parchment mask.png", expect.anything());
  });
});
