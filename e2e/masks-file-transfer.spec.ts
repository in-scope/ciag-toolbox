import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Page } from "@playwright/test";

import {
  fixturePath,
  maskBinary1BitPng,
  maskBinary255Png,
  maskEightBySquarePng,
  maskMultibandPng,
  multiBandTiff,
} from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  closeMasksOptions,
  createTemporaryExportDirectory,
  exportMaskButton,
  exportSelectedMaskToPath,
  importMaskFromPath,
  loadFixtureAsStack,
  maskCategoryNameField,
  maskCategoryNameFields,
  maskLayerNameField,
  maskLayerOpacitySlider,
  maskLayerOptions,
  maskToastContaining,
  npcComputeButton,
  NPC_PANEL_LABEL,
  openMasksOptions,
  openOperation,
  selectPanel,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-303: mask files. The import fixture mask-multiband.png covers
// multiband-12bit.tif (4x4) with two categories - top row category 1, bottom
// row category 2 - and ships mask-multiband.json naming and colouring them.
// The oracle for the export is a REFERENCE DECODER (sharp/libvips in this
// spec's Node context) reading the written PNG back sample-for-sample, plus a
// plain JSON comparison of the sidecar; the refusal case imports the 8x8 mask
// onto the 4x4 stack.

const PANEL = 1;

const EXPECTED_MASK_VALUES = maskMultibandPng.values;

const EXPECTED_DIMENSION_REFUSAL =
  `This mask is ${maskEightBySquarePng.width} x ${maskEightBySquarePng.height} ` +
  `but the stack is ${multiBandTiff.width} x ${multiBandTiff.height}. ` +
  "Import a mask that matches the stack's size.";

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("imports a mask with its sidecar and exports it back to identical files", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await expect(exportMaskButton(page)).toBeDisabled();

  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await expectImportedLayerMatchesTheSidecar(page);

  const exportPath = join(await createTemporaryExportDirectory(), "exported-mask.png");
  await exportSelectedMaskToPath(page, exportPath);
  await expectExportedMaskMatchesTheFixture(page, exportPath);
});

test("imports a 1-bit black-and-white mask as a single painted category", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskBinary1BitPng.fileName));
  await expectImportedLayerCoversExactlyTheTopRow(page, "exported-binary-1bit-mask.png");
  await closeMasksOptions(page);

  await expectNpcStaysLockedWithOneCategory(page);
});

test("maps a 0/255 mask to a single category covering the top row", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskBinary255Png.fileName));
  await expectImportedLayerCoversExactlyTheTopRow(page, "exported-binary-255-mask.png");
  await closeMasksOptions(page);

  await expectNpcStaysLockedWithOneCategory(page);
});

// Both mask-binary-1bit.png (raw sample 1) and mask-binary-255.png (raw
// sample 255, remapped to category 1 by CT-326) paint the SAME top-row
// category, so the exported layer's re-decoded values are identical either
// way and are asserted against the 1-bit fixture's own already-1-based values.
const EXPECTED_TOP_ROW_CATEGORY_VALUES = maskBinary1BitPng.values;

async function expectImportedLayerCoversExactlyTheTopRow(
  page: Page,
  exportFileName: string,
): Promise<void> {
  await runAsStoryboardStep(page, "Check the imported layer's single category", async () => {
    await expect(maskLayerOptions(page)).toHaveCount(1);
    await expect(maskCategoryNameFields(page)).toHaveCount(1);
  });
  const exportPath = join(await createTemporaryExportDirectory(), exportFileName);
  await exportSelectedMaskToPath(page, exportPath);
  await runAsStoryboardStep(page, "Decode the exported binary mask in Node", async () => {
    const decoded = await sharp(exportPath)
      .toColourspace("b-w")
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(Array.from(decoded.data)).toEqual([...EXPECTED_TOP_ROW_CATEGORY_VALUES]);
  });
}

async function expectNpcStaysLockedWithOneCategory(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Check NPC stays locked with one painted category", async () => {
    await openOperation(page, NPC_PANEL_LABEL);
    await expect(npcComputeButton(page)).toBeDisabled();
  });
}

test("refuses a mask whose size does not match the stack", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskEightBySquarePng.fileName));

  await expect(maskToastContaining(page, EXPECTED_DIMENSION_REFUSAL)).toBeVisible();
  await expect(maskLayerOptions(page)).toHaveCount(0);
});

async function expectImportedLayerMatchesTheSidecar(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Check the imported layer against its sidecar", async () => {
    await expect(maskLayerOptions(page)).toHaveCount(1);
    await expect(maskLayerNameField(page)).toHaveValue(maskMultibandPng.name ?? "");
    await expect(maskCategoryNameFields(page)).toHaveCount(2);
    await expect(maskCategoryNameField(page, 1)).toHaveValue(readCategoryName(0));
    await expect(maskCategoryNameField(page, 2)).toHaveValue(readCategoryName(1));
    await expect(maskLayerOpacitySlider(page)).toHaveAttribute(
      "aria-valuenow",
      String(maskMultibandPng.opacity),
    );
  });
}

function readCategoryName(position: number): string {
  return maskMultibandPng.categories?.[position]?.name ?? "";
}

async function expectExportedMaskMatchesTheFixture(
  page: Page,
  exportPath: string,
): Promise<void> {
  await runAsStoryboardStep(page, "Decode the exported mask files in Node", async () => {
    // sharp's default pipeline converts to 3-channel sRGB; "b-w" keeps the
    // single 8-bit channel whose samples ARE the category indexes.
    const decoded = await sharp(exportPath)
      .toColourspace("b-w")
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect({ width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels })
      .toEqual({ width: maskMultibandPng.width, height: maskMultibandPng.height, channels: 1 });
    expect(Array.from(decoded.data)).toEqual([...EXPECTED_MASK_VALUES]);
    expect(await readExportedSidecar(exportPath)).toEqual(await readFixtureSidecar());
  });
}

async function readExportedSidecar(exportPath: string): Promise<unknown> {
  return JSON.parse(await readFile(exportPath.replace(/\.png$/, ".json"), "utf8"));
}

async function readFixtureSidecar(): Promise<unknown> {
  return JSON.parse(
    await readFile(fixturePath(maskMultibandPng.sidecarFileName ?? ""), "utf8"),
  );
}
