import { sanitizeExportBaseName } from "@/lib/image/export-base-name";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import { encodeMaskValuesAsGrayscalePngBytes } from "@/lib/masks/mask-png-encode";
import { serializeMaskSidecarDocument } from "@/lib/masks/mask-sidecar";
import { buildStoredZipArchiveBytes, type ZipEntryToStore } from "@/lib/masks/zip-store-writer";

// CT-327: what an exported mask layer's zip holds. One black-and-white PNG per
// category (255 where the pixel carries that category, 0 everywhere else) is
// what a person can actually LOOK at and what a Python script wants one class
// at a time; the CT-303 index PNG and its JSON sidecar ride along unchanged so
// the same file re-imports as the exact layer that was painted.

export const MASK_EXPORT_FILE_EXTENSION = "zip";
export const CATEGORY_PRESENT_SAMPLE_VALUE = 255;
export const CATEGORY_ABSENT_SAMPLE_VALUE = 0;

const FALLBACK_MASK_FILE_STEM = "mask";
const FALLBACK_MASK_CATEGORY_FILE_STEM = "category";

export function buildCategoryBinaryMaskValues(
  values: Uint8Array,
  categoryIndex: number,
): Uint8Array {
  return Uint8Array.from(values, (value) =>
    value === categoryIndex ? CATEGORY_PRESENT_SAMPLE_VALUE : CATEGORY_ABSENT_SAMPLE_VALUE,
  );
}

export function buildMaskLayerFileStem(layerName: string): string {
  return sanitizeExportBaseName(layerName, FALLBACK_MASK_FILE_STEM);
}

export async function buildMaskLayerZipBytes(layer: MaskLayer): Promise<Uint8Array> {
  return buildStoredZipArchiveBytes(await buildMaskLayerZipEntries(layer));
}

export async function buildMaskLayerZipEntries(
  layer: MaskLayer,
): Promise<ReadonlyArray<ZipEntryToStore>> {
  const layerStem = buildMaskLayerFileStem(layer.name);
  // The layer's own two names are claimed FIRST so a category sharing the
  // layer's name never overwrites the index PNG that re-import reads.
  const takenStems = new Set([layerStem]);
  return [
    ...(await buildCategoryBinaryPngEntries(layer, takenStems)),
    { name: `${layerStem}.png`, bytes: await encodeMaskLayerIndexPngBytes(layer) },
    { name: `${layerStem}.json`, bytes: encodeMaskLayerSidecarBytes(layer) },
  ];
}

async function buildCategoryBinaryPngEntries(
  layer: MaskLayer,
  takenStems: Set<string>,
): Promise<ReadonlyArray<ZipEntryToStore>> {
  const stems = layer.categories.map((category) =>
    claimNextUnusedFileStem(
      sanitizeExportBaseName(category.name, FALLBACK_MASK_CATEGORY_FILE_STEM),
      takenStems,
    ),
  );
  return Promise.all(stems.map((stem, position) => encodeCategoryBinaryPngEntry(layer, position, stem)));
}

// Two categories a user named the same way (or two names that clean to the
// same text) would otherwise collapse into one file, so the second and later
// take " (2)", " (3)", and so on.
function claimNextUnusedFileStem(stem: string, takenStems: Set<string>): string {
  let candidate = stem;
  let occurrence = 1;
  while (takenStems.has(candidate)) {
    occurrence += 1;
    candidate = `${stem} (${occurrence})`;
  }
  takenStems.add(candidate);
  return candidate;
}

async function encodeCategoryBinaryPngEntry(
  layer: MaskLayer,
  categoryPosition: number,
  stem: string,
): Promise<ZipEntryToStore> {
  const values = buildCategoryBinaryMaskValues(layer.values, categoryPosition + 1);
  const bytes = await encodeMaskValuesAsGrayscalePngBytes(layer.width, layer.height, values);
  return { name: `${stem}.png`, bytes };
}

async function encodeMaskLayerIndexPngBytes(layer: MaskLayer): Promise<Uint8Array> {
  return encodeMaskValuesAsGrayscalePngBytes(layer.width, layer.height, layer.values);
}

function encodeMaskLayerSidecarBytes(layer: MaskLayer): Uint8Array {
  return new TextEncoder().encode(serializeMaskSidecarDocument(layer));
}
