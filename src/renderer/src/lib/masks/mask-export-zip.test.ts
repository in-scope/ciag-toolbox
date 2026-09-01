import { describe, expect, it } from "vitest";

import {
  buildCategoryBinaryMaskValues,
  buildMaskLayerZipEntries,
  buildMaskLayerFileStem,
} from "@/lib/masks/mask-export-zip";
import { createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import { decodeMaskPngBytes } from "@/lib/masks/mask-png-decode";
import { parseMaskSidecarDocumentOrNull } from "@/lib/masks/mask-sidecar";

// CT-327: the zip an exported mask layer holds. Two categories over a 4x2
// grid: category 1 on part of the top row, category 2 on part of the bottom.

function buildTwoCategoryLayer(): MaskLayer {
  const layer = createMaskLayer("mask-1", "Parchment mask", 4, 2);
  layer.values.set([0, 1, 1, 0, 2, 2, 0, 0]);
  return layer;
}

function renameCategories(layer: MaskLayer, names: ReadonlyArray<string>): MaskLayer {
  return {
    ...layer,
    categories: layer.categories.map((category, position) => ({
      ...category,
      name: names[position] ?? category.name,
    })),
  };
}

async function listEntryNames(layer: MaskLayer): Promise<ReadonlyArray<string>> {
  return (await buildMaskLayerZipEntries(layer)).map((entry) => entry.name);
}

async function decodeEntryValues(layer: MaskLayer, name: string): Promise<ReadonlyArray<number>> {
  const entries = await buildMaskLayerZipEntries(layer);
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`The zip has no entry named ${name}.`);
  return Array.from((await decodeMaskPngBytes(entry.bytes)).values);
}

describe("buildCategoryBinaryMaskValues", () => {
  it("gives 255 where the category is painted and 0 everywhere else", () => {
    const values = Uint8Array.from([0, 1, 1, 0, 2, 2, 0, 0]);
    expect(Array.from(buildCategoryBinaryMaskValues(values, 1))).toEqual([
      0, 255, 255, 0, 0, 0, 0, 0,
    ]);
    expect(Array.from(buildCategoryBinaryMaskValues(values, 2))).toEqual([
      0, 0, 0, 0, 255, 255, 0, 0,
    ]);
  });

  it("gives an all-zero plane for a category nothing is painted with", () => {
    const values = Uint8Array.from([0, 1, 1, 0]);
    expect(Array.from(buildCategoryBinaryMaskValues(values, 3))).toEqual([0, 0, 0, 0]);
  });
});

describe("buildMaskLayerZipEntries", () => {
  it("holds one PNG per category plus the index PNG and the sidecar", async () => {
    expect(await listEntryNames(buildTwoCategoryLayer())).toEqual([
      "Foreground.png",
      "Background.png",
      "Parchment mask.png",
      "Parchment mask.json",
    ]);
  });

  it("writes each category's PNG as its own black-and-white plane", async () => {
    const layer = buildTwoCategoryLayer();
    expect(await decodeEntryValues(layer, "Foreground.png")).toEqual([
      0, 255, 255, 0, 0, 0, 0, 0,
    ]);
    expect(await decodeEntryValues(layer, "Background.png")).toEqual([
      0, 0, 0, 0, 255, 255, 0, 0,
    ]);
  });

  it("keeps the index PNG's category indexes unchanged", async () => {
    expect(await decodeEntryValues(buildTwoCategoryLayer(), "Parchment mask.png")).toEqual([
      0, 1, 1, 0, 2, 2, 0, 0,
    ]);
  });

  it("keeps the sidecar unchanged", async () => {
    const entries = await buildMaskLayerZipEntries(buildTwoCategoryLayer());
    const sidecar = entries.find((entry) => entry.name === "Parchment mask.json");
    const document = parseMaskSidecarDocumentOrNull(new TextDecoder().decode(sidecar!.bytes));
    expect(document?.name).toBe("Parchment mask");
    expect(document?.categories.map((category) => category.name)).toEqual([
      "Foreground",
      "Background",
    ]);
  });

  it("de-duplicates two categories that clean to the same file name", async () => {
    const layer = renameCategories(buildTwoCategoryLayer(), ["ink/paper", "ink:paper"]);
    expect(await listEntryNames(layer)).toEqual([
      "ink-paper.png",
      "ink-paper (2).png",
      "Parchment mask.png",
      "Parchment mask.json",
    ]);
  });

  it("never lets a category overwrite the layer's own index PNG", async () => {
    const layer = renameCategories(buildTwoCategoryLayer(), ["Parchment mask", "Background"]);
    expect(await listEntryNames(layer)).toEqual([
      "Parchment mask (2).png",
      "Background.png",
      "Parchment mask.png",
      "Parchment mask.json",
    ]);
  });

  it("falls back when a category name cleans away to nothing", async () => {
    const layer = renameCategories(buildTwoCategoryLayer(), ["   ", "..."]);
    expect(await listEntryNames(layer)).toEqual([
      "category.png",
      "category (2).png",
      "Parchment mask.png",
      "Parchment mask.json",
    ]);
  });
});

describe("buildMaskLayerFileStem", () => {
  it("cleans characters a file name cannot hold", () => {
    expect(buildMaskLayerFileStem("ink/paper: layer")).toBe("ink-paper- layer");
  });

  it("falls back when the layer name cleans away to nothing", () => {
    expect(buildMaskLayerFileStem("   ")).toBe("mask");
  });
});
