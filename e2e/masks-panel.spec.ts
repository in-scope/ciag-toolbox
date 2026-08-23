import { join } from "node:path";
import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { maskMultibandPng, multiBandTiff, fixturePath } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  addMaskCategoriesUntilTheControlDisables,
  addMaskCategoryButton,
  applyOperationInPlace,
  applyQuickGeometricTransform,
  createMaskLayer,
  createTemporaryExportDirectory,
  exportSelectedMaskToPath,
  importMaskFromPath,
  loadFixtureAsStack,
  maskCategoryNameField,
  maskCategoryNameFields,
  maskLayerOpacitySlider,
  maskLayerOptions,
  masksOptionsPanel,
  masksRemovedToast,
  MAX_MASK_CATEGORIES,
  openMasksOptions,
  openOperation,
  selectPanel,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-302: mask layers annotate a stack's spatial grid. This spec drives the
// Masks options aside on multiband-12bit.tif (4x4, 3 bands): create a layer,
// rename a category, fill the category list to its cap of five, then check the
// two survival rules through REAL applies - a value operation (Invert, in
// place) leaves the layer alone, while a geometry change (Rotate 90 clockwise,
// in place) carries every layer through the SAME rotation, proven by exporting
// the rotated mask and decoding it in the spec. The 4x4 fixture is square on
// purpose: rotating it keeps the reported width and height, so only the
// operation's own geometry declaration can drive the mask reconciliation.

const PANEL = 1;
const INVERT = "Invert";
const FIRST_CATEGORY = 1;
const RENAMED_CATEGORY = "Parchment";

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("creates a mask layer, renames a category, and caps the category list at five", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await expect(maskLayerOptions(page)).toHaveCount(0);

  await createMaskLayer(page);
  await expect(maskLayerOptions(page)).toHaveCount(1);
  await expect(maskCategoryNameFields(page)).toHaveCount(2);
  await expect(maskCategoryNameField(page, 1)).toHaveValue("Foreground");
  await expect(maskCategoryNameField(page, 2)).toHaveValue("Background");
  await expect(maskLayerOpacitySlider(page)).toHaveAttribute("aria-valuenow", "50");

  await maskCategoryNameField(page, FIRST_CATEGORY).fill(RENAMED_CATEGORY);
  await expect(maskCategoryNameField(page, FIRST_CATEGORY)).toHaveValue(RENAMED_CATEGORY);

  const categoryCount = await addMaskCategoriesUntilTheControlDisables(page);
  expect(categoryCount).toBe(MAX_MASK_CATEGORIES);
  await expect(addMaskCategoryButton(page)).toBeDisabled();
  await expect(maskCategoryNameField(page, FIRST_CATEGORY)).toHaveValue(RENAMED_CATEGORY);
});

test("keeps the panel's masks through an in-place value operation", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await createMaskLayer(page);
  await maskCategoryNameField(page, FIRST_CATEGORY).fill(RENAMED_CATEGORY);

  await openOperation(page, INVERT);
  await applyOperationInPlace(page, INVERT);

  await expect(masksOptionsPanel(page)).toBeVisible();
  await expect(maskLayerOptions(page)).toHaveCount(1);
  await expect(maskCategoryNameField(page, FIRST_CATEGORY)).toHaveValue(RENAMED_CATEGORY);
  await expect(masksRemovedToast(page)).toHaveCount(0);
});

// The fixture mask paints row 0 with category 1 and row 3 with category 2, so
// rotating 90 clockwise must land category 2 in column 0 and category 1 in
// column 3: every row of the rotated mask reads [2, 0, 0, 1].
const ROTATED_MASK_ROW = [2, 0, 0, 1];
const EXPECTED_ROTATED_MASK_VALUES = [
  ...ROTATED_MASK_ROW,
  ...ROTATED_MASK_ROW,
  ...ROTATED_MASK_ROW,
  ...ROTATED_MASK_ROW,
];

test("rotates the panel's masks with an in-place apply that rotates the stack", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await expect(maskLayerOptions(page)).toHaveCount(1);

  await applyQuickGeometricTransform(page, "rotate-90-cw");

  await expect(masksRemovedToast(page)).toHaveCount(0);
  await expect(maskLayerOptions(page)).toHaveCount(1);

  const exportPath = join(await createTemporaryExportDirectory(), "rotated-mask.png");
  await exportSelectedMaskToPath(page, exportPath);
  await runAsStoryboardStep(page, "Decode the exported mask in Node", async () => {
    const decoded = await sharp(exportPath)
      .toColourspace("b-w")
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(Array.from(decoded.data)).toEqual(EXPECTED_ROTATED_MASK_VALUES);
  });
});
