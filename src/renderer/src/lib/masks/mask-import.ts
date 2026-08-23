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
  `This mask uses more than ${MAX_MASK_CATEGORY_COUNT} categories. ` +
  `A mask layer holds at most ${MAX_MASK_CATEGORY_COUNT} categories ` +
  `(pixel values 0 to ${MAX_MASK_CATEGORY_COUNT}).`;

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
  const categoryCount = countCategoriesToBuildForImport(source);
  return {
    name: source.sidecar?.name ?? stripFileExtension(source.fileName),
    width: source.decoded.width,
    height: source.decoded.height,
    values: source.decoded.values,
    categories: buildImportedCategories(categoryCount, source.sidecar),
    opacityPercent: source.sidecar?.opacity ?? DEFAULT_MASK_LAYER_OPACITY_PERCENT,
  };
}

// The layer needs a category per index the PNG actually paints; a sidecar may
// name more (a category the user painted nothing with yet).
function countCategoriesToBuildForImport(source: MaskImportSource): number {
  const painted = findHighestCategoryValueOrThrow(source.decoded.values);
  const described = source.sidecar?.categories.length ?? 0;
  return Math.min(MAX_MASK_CATEGORY_COUNT, Math.max(1, painted, described));
}

function findHighestCategoryValueOrThrow(values: Uint8Array): number {
  let highest = 0;
  for (const value of values) {
    if (value > highest) highest = value;
  }
  if (highest > MAX_MASK_CATEGORY_COUNT) throw new Error(MASK_TOO_MANY_CATEGORIES_MESSAGE);
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
