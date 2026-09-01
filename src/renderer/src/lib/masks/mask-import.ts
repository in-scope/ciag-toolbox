import {
  buildMaskCategoryAtIndex,
  MAX_MASK_CATEGORY_COUNT,
  pickDefaultMaskCategoryColor,
  pickDefaultMaskCategoryName,
  DEFAULT_MASK_LAYER_OPACITY_PERCENT,
  type MaskCategory,
  type MaskLayerContent,
} from "@/lib/masks/mask-layer";
import type { DecodedMaskPng } from "@/lib/masks/mask-png-decode";
import type { MaskSidecarDocument } from "@/lib/masks/mask-sidecar";

// CT-303: turns an imported mask PNG (plus its optional sidecar) into a layer
// for the active panel. Two rules refuse the import outright: a mask whose
// grid does not match the stack it would annotate, and a mask holding a
// category index this app cannot represent.

export interface MaskImportSource {
  readonly fileName: string;
  readonly decoded: DecodedMaskPng;
  readonly sidecar: MaskSidecarDocument | null;
}

export const MASK_TOO_MANY_CATEGORIES_MESSAGE =
  `This mask uses more than ${MAX_MASK_CATEGORY_COUNT} distinct pixel values besides 0. ` +
  `A mask layer holds at most ${MAX_MASK_CATEGORY_COUNT} categories.`;

// CT-326: a mask from another tool rarely paints 1..N already (0/255 is the
// common binary case). Distinct non-zero pixel values are remapped, sorted
// ascending, to 1..N so they become valid category indexes; 0 always stays
// unlabeled. Returns the SAME array when it is already 1..N so callers never
// pay for a copy on the common re-import-of-our-own-export path.
export function remapMaskValuesToCategoryIndexes(values: Uint8Array): Uint8Array {
  const distinctNonZeroSorted = collectDistinctNonZeroValuesSorted(values);
  if (distinctNonZeroSorted.length > MAX_MASK_CATEGORY_COUNT) {
    throw new Error(MASK_TOO_MANY_CATEGORIES_MESSAGE);
  }
  if (isAlreadyAscendingFromOne(distinctNonZeroSorted)) return values;
  const remapTable = buildRemapTableToAscendingIndexes(distinctNonZeroSorted);
  return Uint8Array.from(values, (value) => remapTable[value] ?? 0);
}

function collectDistinctNonZeroValuesSorted(values: Uint8Array): number[] {
  const distinct = new Set<number>();
  for (const value of values) {
    if (value !== 0) distinct.add(value);
  }
  return Array.from(distinct).sort((a, b) => a - b);
}

function isAlreadyAscendingFromOne(sortedDistinctValues: ReadonlyArray<number>): boolean {
  return sortedDistinctValues.every((value, index) => value === index + 1);
}

function buildRemapTableToAscendingIndexes(sortedDistinctValues: ReadonlyArray<number>): Uint8Array {
  const table = new Uint8Array(256);
  sortedDistinctValues.forEach((rawValue, index) => {
    table[rawValue] = index + 1;
  });
  return table;
}

export interface MaskGridSize {
  readonly width: number;
  readonly height: number;
}

export function describeMaskDimensionMismatchOrNull(
  mask: MaskGridSize,
  stackWidth: number,
  stackHeight: number,
): string | null {
  if (mask.width === stackWidth && mask.height === stackHeight) return null;
  return (
    `This mask is ${mask.width} x ${mask.height} but the stack is ` +
    `${stackWidth} x ${stackHeight}. Import a mask that matches the stack's size.`
  );
}

export function buildImportedMaskLayerContent(source: MaskImportSource): MaskLayerContent {
  const values = remapMaskValuesToCategoryIndexes(source.decoded.values);
  const categoryCount = countCategoriesToBuildForImport(values, source.sidecar);
  return {
    name: source.sidecar?.name ?? stripFileExtension(source.fileName),
    width: source.decoded.width,
    height: source.decoded.height,
    values,
    categories: buildImportedCategories(categoryCount, source.sidecar),
    opacityPercent: source.sidecar?.opacity ?? DEFAULT_MASK_LAYER_OPACITY_PERCENT,
  };
}

// The layer needs a category per index the (already remapped) PNG actually
// paints; a sidecar may name more (a category the user painted nothing with
// yet).
function countCategoriesToBuildForImport(
  values: Uint8Array,
  sidecar: MaskSidecarDocument | null,
): number {
  const painted = findHighestCategoryValue(values);
  const described = sidecar?.categories.length ?? 0;
  return Math.min(MAX_MASK_CATEGORY_COUNT, Math.max(1, painted, described));
}

function findHighestCategoryValue(values: Uint8Array): number {
  let highest = 0;
  for (const value of values) {
    if (value > highest) highest = value;
  }
  return highest;
}

function buildImportedCategories(
  categoryCount: number,
  sidecar: MaskSidecarDocument | null,
): ReadonlyArray<MaskCategory> {
  return Array.from({ length: categoryCount }, (_, index) =>
    buildImportedCategoryAtIndex(index, sidecar),
  );
}

function buildImportedCategoryAtIndex(
  index: number,
  sidecar: MaskSidecarDocument | null,
): MaskCategory {
  const described = sidecar?.categories.find((category) => category.index === index + 1);
  return buildMaskCategoryAtIndex(
    index,
    described?.name ?? pickDefaultMaskCategoryName(index),
    described?.color ?? pickDefaultMaskCategoryColor(index),
  );
}

function stripFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot <= 0 ? fileName : fileName.slice(0, lastDot);
}
