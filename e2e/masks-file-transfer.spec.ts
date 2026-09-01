import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import {
  builtinScriptReferences,
  fixturePath,
  maskBinary1BitPng,
  maskBinary255Png,
  maskBinaryBottom255Png,
  maskEightBySquarePng,
  maskMultibandCategoriesZip,
  maskMultibandPng,
  multiBandTiff,
} from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  clickPanelToSelect,
  closeMasksOptions,
  computeNpcScores,
  createTemporaryExportDirectory,
  decodeSingleChannelPngBuffer,
  exportMaskButton,
  exportSelectedMaskAndDecodeIndexPng,
  exportSelectedMaskToZipPath,
  expectScoreWithinRelativeTolerance,
  importMaskFromPath,
  importMasksFromPaths,
  loadFixtureAsStack,
  maskCategoryColorField,
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
  panelCanvas,
  readZipEntriesByName,
  selectPanel,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-303: mask files. The import fixture mask-multiband.png covers
// multiband-12bit.tif (4x4) with two categories - top row category 1, bottom
// row category 2 - and ships mask-multiband.json naming and colouring them.
//
// CT-327: an export writes ONE zip. Its oracles are a real zip reader (yauzl,
// in this spec's Node context) for the entry names, and a REFERENCE DECODER
// (sharp/libvips) reading each PNG entry back sample-for-sample, plus a plain
// JSON comparison of the sidecar entry.
//
// CT-328: an import accepts one PNG, several PNGs, or one zip. The round trip
// is the headline: exporting a layer and importing the archive back onto a
// FRESH panel must give the same labelling AND the same NPC scores, which are
// pinned by manifest.json's reference runner.

const PANEL = 1;
const SECOND_PANEL = 2;

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

test("round-trips an exported mask zip onto a fresh panel", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));

  const exportPath = join(await createTemporaryExportDirectory(), "round-trip-mask.zip");
  await exportSelectedMaskToZipPath(page, exportPath);
  await expectZipHoldsTheExportedEntryNames(page, exportPath);

  await giveTheSecondPanelItsOwnCopyOfTheStack(page);
  await importMaskFromPath(page, exportPath);

  await expectImportedLayerMatchesTheSidecar(page);
  await expectNpcMatchesTheReferenceScores(page);
});

test("imports a zip written by another tool losslessly", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandCategoriesZip.fileName));

  await expectImportedLayerMatchesTheSidecar(page);
  const exportPath = join(await createTemporaryExportDirectory(), "from-deflated-zip.zip");
  const decoded = await exportSelectedMaskAndDecodeIndexPng(page, exportPath);
  expect(decoded.values).toEqual([...EXPECTED_MASK_VALUES]);
});

test("imports several mask PNGs at once as one category per file", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMasksFromPaths(page, [
    fixturePath(maskBinary1BitPng.fileName),
    fixturePath(maskBinary255Png.fileName),
  ]);

  await expectCombinedLayerNamedAfterItsFiles(page, [
    stripExtension(maskBinary1BitPng.fileName),
    stripExtension(maskBinary255Png.fileName),
  ]);
  await expectLastPickedFileWinsTheSharedTopRow(page);
});

test("unlocks NPC after importing two per-class masks together", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMasksFromPaths(page, [
    fixturePath(maskBinary1BitPng.fileName),
    fixturePath(maskBinaryBottom255Png.fileName),
  ]);

  await expectCombinedLayerNamedAfterItsFiles(page, [
    stripExtension(maskBinary1BitPng.fileName),
    stripExtension(maskBinaryBottom255Png.fileName),
  ]);
  await closeMasksOptions(page);
  await expectNpcMatchesTheReferenceScores(page);
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

test("refuses a mask whose size does not match the stack", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskEightBySquarePng.fileName));

  await expect(maskToastContaining(page, EXPECTED_DIMENSION_REFUSAL)).toBeVisible();
  await expect(maskLayerOptions(page)).toHaveCount(0);
});

test("refuses a multi-file import naming the file that misses the stack", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await importMasksFromPaths(page, [
    fixturePath(maskBinary1BitPng.fileName),
    fixturePath(maskEightBySquarePng.fileName),
  ]);

  const expected = `${maskEightBySquarePng.fileName}: ${EXPECTED_DIMENSION_REFUSAL}`;
  await expect(maskToastContaining(page, expected)).toBeVisible();
  await expect(maskLayerOptions(page)).toHaveCount(0);
});

function stripExtension(fileName: string): string {
  return fileName.slice(0, fileName.lastIndexOf("."));
}

// The second panel is empty, so opening the fixture again lands there; the
// Masks tool is active, so re-selecting has to use the cell's corner strip
// rather than a centred click that the brush would claim.
async function giveTheSecondPanelItsOwnCopyOfTheStack(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Load the same stack into a second, fresh panel", async () => {
    await loadFixtureAsStack(page, multiBandTiff.fileName);
    await expect(panelCanvas(page, SECOND_PANEL)).toBeVisible();
    await clickPanelToSelect(page, SECOND_PANEL);
    await expect(maskLayerOptions(page)).toHaveCount(0);
  });
}

async function expectCombinedLayerNamedAfterItsFiles(
  page: Page,
  expectedCategoryNames: ReadonlyArray<string>,
): Promise<void> {
  await runAsStoryboardStep(page, "Check the combined layer and its categories", async () => {
    await expect(maskLayerOptions(page)).toHaveCount(1);
    await expect(maskLayerNameField(page)).toHaveValue("Imported masks");
    await expect(maskCategoryNameFields(page)).toHaveCount(expectedCategoryNames.length);
    for (const [position, name] of expectedCategoryNames.entries()) {
      await expect(maskCategoryNameField(page, position + 1)).toHaveValue(name);
    }
  });
}

// Both binary fixtures paint the SAME top row, so the second file picked takes
// every one of those pixels and the first category ends up empty.
async function expectLastPickedFileWinsTheSharedTopRow(page: Page): Promise<void> {
  const exportPath = join(await createTemporaryExportDirectory(), "combined-overlap-mask.zip");
  const decoded = await exportSelectedMaskAndDecodeIndexPng(page, exportPath);
  expect(decoded.values).toEqual(
    [...maskBinary1BitPng.values].map((value) => (value === 0 ? 0 : 2)),
  );
}

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

// The reference runner pinned one NPC score per band for the top-row/bottom-row
// labelling; a layer that survived the round trip (or that several per-class
// files rebuilt) must score the same, band for band.
async function expectNpcMatchesTheReferenceScores(page: Page): Promise<void> {
  await openOperation(page, NPC_PANEL_LABEL);
  const rows = await computeNpcScores(page);
  const expected = describeExpectedTopBandRows(builtinScriptReferences.npc.value);
  expect(rows.map((row) => row.bandIdentityText)).toEqual(
    expected.map((row) => row.bandIdentityText),
  );
  rows.forEach((row, index) => {
    expectScoreWithinRelativeTolerance(Number(row.scoreText), expected[index]?.score ?? NaN);
  });
}

// The panel lists the bands best first, ties broken by band order.
function describeExpectedTopBandRows(
  scores: ReadonlyArray<number>,
): ReadonlyArray<{ bandIdentityText: string; score: number }> {
  return scores
    .map((score, bandIndex) => ({ bandIdentityText: `Band ${bandIndex + 1}`, score, bandIndex }))
    .sort((left, right) => right.score - left.score || left.bandIndex - right.bandIndex);
}

async function expectImportedLayerMatchesTheSidecar(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Check the imported layer against its sidecar", async () => {
    await expect(maskLayerOptions(page)).toHaveCount(1);
    await expect(maskLayerNameField(page)).toHaveValue(maskMultibandPng.name ?? "");
    await expect(maskCategoryNameFields(page)).toHaveCount(2);
    await expectCategoryReadsItsSidecarNameAndColor(page, 1);
    await expectCategoryReadsItsSidecarNameAndColor(page, 2);
    await expect(maskLayerOpacitySlider(page)).toHaveAttribute(
      "aria-valuenow",
      String(maskMultibandPng.opacity),
    );
  });
}

async function expectCategoryReadsItsSidecarNameAndColor(
  page: Page,
  position: number,
): Promise<void> {
  const described = maskMultibandPng.categories?.[position - 1];
  await expect(maskCategoryNameField(page, position)).toHaveValue(described?.name ?? "");
  await expect(maskCategoryColorField(page, position)).toHaveValue(described?.color ?? "");
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

async function expectZipHoldsTheExportedEntryNames(
  page: Page,
  exportPath: string,
): Promise<void> {
  await runAsStoryboardStep(page, "Read the exported zip's entry names in Node", async () => {
    const entries = await readZipEntriesByName(exportPath);
    expect(Array.from(entries.keys())).toEqual(EXPECTED_ZIP_ENTRY_NAMES);
  });
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
