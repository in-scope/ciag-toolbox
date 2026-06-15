import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  averageNonClearCanvasColor,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  historyEntryCount,
  loadImageFromAbsolutePath,
  nonClearPixelFraction,
  openOperation,
  operationPanel,
  panelCanvas,
  selectActiveBandNumber,
  setOperationNumberParameter,
  summarizeCanvasPixels,
  writeTemporaryMultiBandUint16Tiff,
  type CanvasAverageColor,
  type PixelDimensions,
} from "./support/page-objects";

// CT-145 / manual section 12 / CT-086: False-color Composite maps three chosen source
// bands to the R, G, B output display channels. Three labelled inputs (Band R/G/B)
// preview the composite LIVE before Apply; the mapping is ORDER-SENSITIVE (swapping two
// assignments changes the composite). An out-of-range band shows inline validation,
// suppresses the preview, and the Apply is rejected with a clear message. A valid combo
// commits a 3-band composite and records the assignments in History.
//
// FIXTURE: the committed multiband-12bit.tif has three identically shaped gradient bands,
// so every assignment stretches to the same preview bytes and a swap would be invisible.
// CT-145 needs DISTINCT per-band patterns, so a throwaway 3-band uint16 TIFF is written
// whose band 1 is dim with a bright top-left corner, band 3 is bright with a dark
// top-left corner, and band 2 is uniform. Swapping R and B then flips the composite color.

const FALSE_COLOR_LABEL = "False-color Composite";
const PANEL = 1;
const SIDE = 4;
const BAND_COUNT = 3;
const FOUR_BY_FOUR: PixelDimensions = { width: SIDE, height: SIDE };
const UINT16 = "uint16";
const DOMINANT_CHANNEL_MARGIN = 40;
const PREVIEW_LIVE_FRACTION = 0.15;
const PREVIEW_SUPPRESSED_FRACTION = 0.08;

const TOP_LEFT_BRIGHT_BAND = buildSingleCornerBand(100, 4000);
const UNIFORM_BAND = buildUniformBand(1000);
const TOP_LEFT_DARK_BAND = buildSingleCornerBand(4000, 100);

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("three Band R/G/B inputs preview live and swapping two changes the composite color", async () => {
  await loadDistinctBandStackIntoPanelOne();
  await openOperation(launched.window, FALSE_COLOR_LABEL);
  await expectThreeLabelledBandInputs();

  await expectPreviewIsLive();
  const blueChannelComposite = await averageNonClearCanvasColor(panelCanvas(launched.window, PANEL));
  await swapRedAndBlueBandAssignments();
  await expectRedChannelDominatesAfterSwap();

  expect(blueChannelComposite.blue).toBeGreaterThan(blueChannelComposite.red + DOMINANT_CHANNEL_MARGIN);
  expect(await historyEntryCount(launched.window)).toBe(0);
});

test("a valid combination commits a 3-band composite and records the assignments in History", async () => {
  await loadDistinctBandStackIntoPanelOne();
  await openOperation(launched.window, FALSE_COLOR_LABEL);
  await assignBands({ red: 3, green: 2, blue: 1 });
  await applyOperationInPlace(launched.window, FALSE_COLOR_LABEL);

  await expectThreeBandUint16Result();
  await expectBandReadout(1, 0, 0, TOP_LEFT_DARK_BAND[0]!);
  await expectBandReadout(3, 0, 0, TOP_LEFT_BRIGHT_BAND[0]!);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: FALSE_COLOR_LABEL,
    detailSubstrings: ["R band 3", "G band 2", "B band 1"],
  });
  expect(await historyEntryCount(launched.window)).toBe(1);
});

test("an out-of-range band number triggers inline validation, suppresses the preview, and rejects Apply", async () => {
  await loadDistinctBandStackIntoPanelOne();
  await openOperation(launched.window, FALSE_COLOR_LABEL);
  await expectPreviewIsLive();

  await enterOutOfRangeRedBand();
  await expectRedBandInputShowsRangeError();
  await expectPreviewIsSuppressed();
  await expectApplyIsRejectedWithClearMessage();
});

async function loadDistinctBandStackIntoPanelOne(): Promise<void> {
  const filePath = await writeTemporaryMultiBandUint16Tiff({
    width: SIDE,
    height: SIDE,
    bands: [TOP_LEFT_BRIGHT_BAND, UNIFORM_BAND, TOP_LEFT_DARK_BAND],
  });
  await loadImageFromAbsolutePath(launched.window, filePath);
}

async function expectThreeLabelledBandInputs(): Promise<void> {
  for (const label of ["Band R", "Band G", "Band B"]) {
    await expect(bandInput(label)).toBeVisible();
  }
}

async function expectPreviewIsLive(): Promise<void> {
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(panelCanvas(launched.window, PANEL))))
    .toBeGreaterThan(PREVIEW_LIVE_FRACTION);
}

async function expectPreviewIsSuppressed(): Promise<void> {
  await expect
    .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(panelCanvas(launched.window, PANEL))))
    .toBeLessThan(PREVIEW_SUPPRESSED_FRACTION);
}

async function swapRedAndBlueBandAssignments(): Promise<void> {
  await setOperationNumberParameter(launched.window, FALSE_COLOR_LABEL, "Band R", 3);
  await setOperationNumberParameter(launched.window, FALSE_COLOR_LABEL, "Band B", 1);
}

async function expectRedChannelDominatesAfterSwap(): Promise<void> {
  await expect
    .poll(async () => channelDifferenceRedMinusBlue(await averageNonClearCanvasColor(panelCanvas(launched.window, PANEL))))
    .toBeGreaterThan(DOMINANT_CHANNEL_MARGIN);
}

function channelDifferenceRedMinusBlue(color: CanvasAverageColor): number {
  return color.red - color.blue;
}

async function assignBands(assignment: { red: number; green: number; blue: number }): Promise<void> {
  await setOperationNumberParameter(launched.window, FALSE_COLOR_LABEL, "Band R", assignment.red);
  await setOperationNumberParameter(launched.window, FALSE_COLOR_LABEL, "Band G", assignment.green);
  await setOperationNumberParameter(launched.window, FALSE_COLOR_LABEL, "Band B", assignment.blue);
}

async function expectThreeBandUint16Result(): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: SIDE, height: SIDE });
}

async function expectBandReadout(band: number, imageX: number, imageY: number, expected: number): Promise<void> {
  await selectActiveBandNumber(launched.window, band);
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX,
    imageY,
    dimensions: FOUR_BY_FOUR,
    expected,
  });
}

async function enterOutOfRangeRedBand(): Promise<void> {
  // The "Band R" label gains the inline error text once the value is invalid, so its
  // accessible name changes; target the input positionally to stay stable across that.
  await redBandNumberInput().fill("99");
}

async function expectRedBandInputShowsRangeError(): Promise<void> {
  await expect(redBandNumberInput()).toHaveAttribute("aria-invalid", "true");
  await expect(operationPanel(launched.window, FALSE_COLOR_LABEL)).toContainText(`Band must be between 1 and ${BAND_COUNT}`);
}

function redBandNumberInput(): Locator {
  return operationPanel(launched.window, FALSE_COLOR_LABEL).locator('input[type="number"]').first();
}

async function expectApplyIsRejectedWithClearMessage(): Promise<void> {
  await applyOperationInPlace(launched.window, FALSE_COLOR_LABEL);
  await expect(falseColorErrorToast(launched.window)).toContainText("out of range");
  await expectThreeBandUint16Result();
  await expectBandReadout(1, 0, 0, TOP_LEFT_BRIGHT_BAND[0]!);
  expect(await historyEntryCount(launched.window)).toBe(0);
}

function bandInput(label: string): Locator {
  return operationPanel(launched.window, FALSE_COLOR_LABEL).getByLabel(label, { exact: true });
}

function falseColorErrorToast(page: Page): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: `${FALSE_COLOR_LABEL} failed` });
}

function buildSingleCornerBand(fillValue: number, topLeftValue: number): number[] {
  const band = buildUniformBand(fillValue);
  band[0] = topLeftValue;
  return band;
}

function buildUniformBand(value: number): number[] {
  return new Array<number>(SIDE * SIDE).fill(value);
}
