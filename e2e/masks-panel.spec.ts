import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  addMaskCategoriesUntilTheControlDisables,
  addMaskCategoryButton,
  applyOperationInPlace,
  applyQuickGeometricTransform,
  createMaskLayer,
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

// CT-302: mask layers annotate a stack's spatial grid. This spec drives the
// Masks options aside on multiband-12bit.tif (4x4, 3 bands): create a layer,
// rename a category, fill the category list to its cap of five, then check the
// two survival rules through REAL applies - a value operation (Invert, in
// place) leaves the layer alone, while a geometry change (Rotate 90 clockwise,
// in place) drops every layer and says so in a toast. The 4x4 fixture is
// square on purpose: rotating it keeps the reported width and height, so only
// the operation's own geometry declaration can drive the drop.

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

test("drops the panel's masks when an in-place apply changes the stack's geometry", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await createMaskLayer(page);
  await expect(maskLayerOptions(page)).toHaveCount(1);

  await applyQuickGeometricTransform(page, "rotate-90-cw");

  await expect(masksRemovedToast(page)).toBeVisible();
  await expect(maskLayerOptions(page)).toHaveCount(0);
  await expect(maskCategoryNameFields(page)).toHaveCount(0);
});
