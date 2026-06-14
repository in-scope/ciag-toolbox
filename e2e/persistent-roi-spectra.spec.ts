import { expect, test } from "@playwright/test";

import { enviStack } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  drawInspectionRoiBetweenPixels,
  ensureRegionToolInactive,
  expectRegionSpectrumCount,
  loadFixtureAsStack,
  pinPixelSpectrum,
  pinnedPixelSpectrumLegendRows,
  regionMeanSpectrumLineWithColor,
  regionSpectrumLegendRows,
  spectraPlot,
  type ImagePixel,
} from "./support/page-objects";

// CT-147 / manual section 14 (CT-088): persistent ROI spectra on the spectra chart.
//   AC1 - one inspection region shows a mean spectrum with a +/- 1 sigma envelope.
//   AC2 - a second region adds a second, distinguishable spectrum (different color); a third
//          drops the oldest, so at most two region spectra remain.
//   AC3 - a pinned single-pixel spectrum coexists with the two region spectra; neither evicts
//          the other (they live in separate per-panel state arrays).
//
// Oracle: the ENVI stack is a 3-band uint16 gradient, so any 2x2 region has non-zero variance
// and therefore a real, visible sigma envelope. The envelope renders as the only path carrying
// the "opacity-20" class (regionMeanSpectrumEnvelopes), so its count equals the number of
// region spectra. Region colors are assigned by position (ROI 1 -> text-primary, ROI 2 ->
// text-fuchsia-400), which is what makes the two spectra "distinguishable". The legend row
// "ROI N mean (n=Npx) +/- 1 sigma" carries the +/- 1 sigma semantics; "Pixel (x, y)" rows
// are the pinned single-pixel spectra. The region tool must be OFF to pin a pixel, and toggling
// it off only clears the live inspection box (roi:null) - it leaves pinnedRoiSpectra intact.

const PANEL = 1;
const SOURCE_DIMENSIONS = { width: enviStack.width, height: enviStack.height };

const FIRST_REGION_COLOR_CLASS = "text-primary";
const SECOND_REGION_COLOR_CLASS = "text-fuchsia-400";

interface RegionDrag {
  readonly start: ImagePixel;
  readonly end: ImagePixel;
}

const REGION_A: RegionDrag = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
const REGION_B: RegionDrag = { start: { x: 2, y: 2 }, end: { x: 3, y: 3 } };
const REGION_C: RegionDrag = { start: { x: 0, y: 2 }, end: { x: 1, y: 3 } };
const PINNED_PIXEL: ImagePixel = { x: 1, y: 1 };

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, enviStack.headerFileName);
  await activateRegionTool(launched.window);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("one inspection region shows its mean spectrum with a +/- 1 sigma envelope", async () => {
  await drawRegion(REGION_A);
  await expect(spectraPlot(launched.window)).toBeVisible();
  await expectRegionSpectrumCount(launched.window, 1);
  await expect(regionSpectrumLegendRows(launched.window)).toHaveCount(1);
  await expect(regionMeanSpectrumLineWithColor(launched.window, FIRST_REGION_COLOR_CLASS)).toHaveCount(1);
});

test("a second region adds a second, distinguishable spectrum", async () => {
  await drawRegion(REGION_A);
  await drawRegion(REGION_B);
  await expectRegionSpectrumCount(launched.window, 2);
  await expect(regionSpectrumLegendRows(launched.window)).toHaveCount(2);
  await expectTwoDistinctlyColoredRegionMeanLines();
});

test("a third region drops the oldest, keeping at most two", async () => {
  await drawRegion(REGION_A);
  await drawRegion(REGION_B);
  await drawRegion(REGION_C);
  await expectRegionSpectrumCount(launched.window, 2);
  await expect(regionSpectrumLegendRows(launched.window)).toHaveCount(2);
  await expectTwoDistinctlyColoredRegionMeanLines();
});

test("a pinned pixel spectrum coexists with the two region spectra", async () => {
  await drawRegion(REGION_A);
  await drawRegion(REGION_B);
  await ensureRegionToolInactive(launched.window);
  await pinPixelSpectrum(launched.window, PANEL, PINNED_PIXEL.x, PINNED_PIXEL.y, SOURCE_DIMENSIONS);
  await expect(pinnedPixelSpectrumLegendRows(launched.window)).toHaveCount(1);
  await expectRegionSpectrumCount(launched.window, 2);
  await expect(regionSpectrumLegendRows(launched.window)).toHaveCount(2);
});

async function expectTwoDistinctlyColoredRegionMeanLines(): Promise<void> {
  await expect(regionMeanSpectrumLineWithColor(launched.window, FIRST_REGION_COLOR_CLASS)).toHaveCount(1);
  await expect(regionMeanSpectrumLineWithColor(launched.window, SECOND_REGION_COLOR_CLASS)).toHaveCount(1);
}

async function drawRegion(region: RegionDrag): Promise<void> {
  await drawInspectionRoiBetweenPixels(
    launched.window,
    PANEL,
    region.start,
    region.end,
    SOURCE_DIMENSIONS,
  );
}
