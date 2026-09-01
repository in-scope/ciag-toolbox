import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
  decodeSingleChannelPngBuffer,
  exportMaskButton,
  exportSelectedMaskAndDecodeIndexPng,
  exportSelectedMaskToZipPath,
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
  readZipEntriesByName,
  selectPanel,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-303: mask files. The import fixture mask-multiband.png covers
// multiband-12bit.tif (4x4) with two categories - top row category 1, bottom
// row category 2 - and ships mask-multiband.json naming and colouring them.
//
// CT-327: an export now writes ONE zip. Its oracles are a real zip reader
// (yauzl, in this spec's Node context) for the entry names, and a REFERENCE
// DECODER (sharp/libvips) reading each PNG entry back sample-for-sample, plus
// a plain JSON comparison of the sidecar entry; the refusal case imports the
// 8x8 mask onto the 4x4 stack.

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

  const exportPath = join(await createTemporaryExportDirectory(), "exported-mask.zip");
  await exportSelectedMaskToZipPath(page, exportPath);
  await expectExportedZipMatchesTheFixture(page, exportPath);
});

test("imports a 1-bit black-and-white mask as a single painted category", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskBinary1BitPng.fileName));
  await expectImportedLayerCoversExactlyTheTopRow(page, "exported-binary-1bit-mask.zip");
  await closeMasksOptions(page);

  await expectNpcStaysLockedWithOneCategory(page);
});

test("maps a 0/255 mask to a single category covering the top row", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskBinary255Png.fileName));
  await expectImportedLayerCoversExactlyTheTopRow(page, "exported-binary-255-mask.zip");
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
  const decoded = await exportSelectedMaskAndDecodeIndexPng(page, exportPath);
  expect(decoded.values).toEqual([...EXPECTED_TOP_ROW_CATEGORY_VALUES]);
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

// The zip's four entries: one black-and-white PNG per category, then the index
// PNG of category indexes and its JSON sidecar, both unchanged from CT-303.
// "Parchment" and "Substrate" are the fixture sidecar's category names;
// "Parchment mask" is the layer's own.
const EXPECTED_ZIP_ENTRY_NAMES = [
  "Parchment.png",
  "Substrate.png",
  "Parchment mask.png",
  "Parchment mask.json",
];

function expectedCategoryBinaryValues(categoryIndex: number): number[] {
  return [...EXPECTED_MASK_VALUES].map((value) => (value === categoryIndex ? 255 : 0));
}

async function expectExportedZipMatchesTheFixture(
  page: Page,
  exportPath: string,
): Promise<void> {
  const entries = await readZipEntriesByName(exportPath);
  await runAsStoryboardStep(page, "Read the exported zip's entries in Node", async () => {
    expect(Array.from(entries.keys())).toEqual(EXPECTED_ZIP_ENTRY_NAMES);
    await expectIndexPngEntryMatchesTheFixture(entries);
    await expectCategoryBinaryEntriesSplitTheMask(entries);
    expect(JSON.parse(entries.get("Parchment mask.json")!.toString("utf8"))).toEqual(
      await readFixtureSidecar(),
    );
  });
}

async function expectIndexPngEntryMatchesTheFixture(
  entries: ReadonlyMap<string, Buffer>,
): Promise<void> {
  const decoded = await decodeSingleChannelPngBuffer(entries.get("Parchment mask.png")!);
  expect({ width: decoded.width, height: decoded.height, channels: decoded.channels })
    .toEqual({ width: maskMultibandPng.width, height: maskMultibandPng.height, channels: 1 });
  expect(decoded.values).toEqual([...EXPECTED_MASK_VALUES]);
}

async function expectCategoryBinaryEntriesSplitTheMask(
  entries: ReadonlyMap<string, Buffer>,
): Promise<void> {
  const parchment = await decodeSingleChannelPngBuffer(entries.get("Parchment.png")!);
  const substrate = await decodeSingleChannelPngBuffer(entries.get("Substrate.png")!);
  expect(parchment.values).toEqual(expectedCategoryBinaryValues(1));
  expect(substrate.values).toEqual(expectedCategoryBinaryValues(2));
}

async function readFixtureSidecar(): Promise<unknown> {
  return JSON.parse(
    await readFile(fixturePath(maskMultibandPng.sidecarFileName ?? ""), "utf8"),
  );
}
