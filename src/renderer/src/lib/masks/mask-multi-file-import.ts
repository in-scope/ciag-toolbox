import {
  buildMaskCategoryAtIndex,
  DEFAULT_MASK_LAYER_OPACITY_PERCENT,
  MAX_MASK_CATEGORY_COUNT,
  pickDefaultMaskCategoryColor,
  UNLABELED_MASK_VALUE,
  type MaskCategory,
  type MaskLayerContent,
} from "@/lib/masks/mask-layer";
import { stripFileExtension } from "@/lib/masks/mask-import";
import type { DecodedMaskPng } from "@/lib/masks/mask-png-decode";

// CT-328: several black-and-white masks, one per class, become ONE layer with
// one category per file. This is how per-class masks arrive from Python, from
// ImageJ, and from inside a third-party zip, so the same combiner serves the
// multi-select import and the zip import.
//
// The rules are positional: a file's PICK ORDER is its category index, its
// stem is the category's name, and the default palette colours the categories
// in that same order. A pixel labeled by more than one file takes the LAST
// file's category, so overlapping classes resolve the way a person stacking
// layers would expect.

export interface MaskFileToCombine {
  readonly fileName: string;
  readonly decoded: DecodedMaskPng;
}

export const COMBINED_MASK_LAYER_NAME = "Imported masks";

export const TOO_MANY_MASK_FILES_MESSAGE =
  `Select at most ${MAX_MASK_CATEGORY_COUNT} mask files, one per category.`;

export const NO_MASK_FILES_MESSAGE = "Select at least one mask file.";

export function refuseMoreMaskFilesThanCategories(fileCount: number): void {
  if (fileCount > MAX_MASK_CATEGORY_COUNT) throw new Error(TOO_MANY_MASK_FILES_MESSAGE);
}

export function combineMaskFilesIntoOneLayer(
  files: ReadonlyArray<MaskFileToCombine>,
): MaskLayerContent {
  refuseMoreMaskFilesThanCategories(files.length);
  const first = files[0];
  if (first === undefined) throw new Error(NO_MASK_FILES_MESSAGE);
  return {
    name: COMBINED_MASK_LAYER_NAME,
    width: first.decoded.width,
    height: first.decoded.height,
    values: paintEveryFileAsItsOwnCategory(files, first.decoded.values.length),
    categories: files.map(buildCategoryNamedAfterItsFile),
    opacityPercent: DEFAULT_MASK_LAYER_OPACITY_PERCENT,
  };
}

function paintEveryFileAsItsOwnCategory(
  files: ReadonlyArray<MaskFileToCombine>,
  pixelCount: number,
): Uint8Array {
  const values = new Uint8Array(pixelCount);
  files.forEach((file, position) =>
    paintOneFileIntoCategory(values, file.decoded.values, position + 1),
  );
  return values;
}

// Writes into the layer being built, which nothing else is reading yet; later
// files overwrite earlier ones, which IS the locked last-file-wins rule.
function paintOneFileIntoCategory(
  values: Uint8Array,
  fileValues: Uint8Array,
  categoryValue: number,
): void {
  for (let index = 0; index < values.length; index += 1) {
    if (fileValues[index] !== UNLABELED_MASK_VALUE) values[index] = categoryValue;
  }
}

function buildCategoryNamedAfterItsFile(
  file: MaskFileToCombine,
  position: number,
): MaskCategory {
  return buildMaskCategoryAtIndex(
    position,
    stripFileExtension(file.fileName),
    pickDefaultMaskCategoryColor(position),
  );
}
