import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  drawInspectionRoiBetweenPixels,
  ensureRegionToolInactive,
  expectExactlyOneCommittedRoi,
  expectNoCommittedRoiMarkers,
  loadFixtureAsStack,
  plainClickImagePixel,
  readRegionStats,
  regionSection,
  selectPanel,
  type ImagePixel,
} from "./support/page-objects";

// CT-132 / manual sections 21-22 (CT-039 / CT-096): ROI selection and Region stats.
//   AC1 - drawing an ROI updates the Region panel stats consistently with the fixture. The
//   Stage-3 Region section reports geometry only (Corners + Size; CT-092 removed per-pixel
//   stats from the panel, they now live in the status bar / spectra), so "consistent with the
//   fixture's known content" means the Size matches the known 4x4 fixture and the inclusive
//   corners are exact - and the stats re-track when the ROI is redrawn.
//   AC2 - clicking outside the ROI, or toggling the region tool off, removes the box and ALL
//   markers; drawing successive ROIs leaves exactly one box with one set of four corner
//   handles, with zero stray markers accumulating.

const PANEL = 1;
const SOURCE_DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };

const SUB_REGION_TOP_LEFT: ImagePixel = { x: 1, y: 1 };
const SUB_REGION_BOTTOM_RIGHT: ImagePixel = { x: 2, y: 2 };
const FULL_REGION_TOP_LEFT: ImagePixel = { x: 0, y: 0 };
const FULL_REGION_BOTTOM_RIGHT: ImagePixel = {
  x: multiBandTiff.width - 1,
  y: multiBandTiff.height - 1,
};
const OUTSIDE_PIXEL: ImagePixel = { x: 3, y: 3 };

// Five non-overlapping 2x2 ROIs across the 4x4 fixture; each spans two pixels so the drag
// exceeds the click threshold and commits, and each sits in a distinct place so an
// accumulation bug would leave stray handles behind.
const SUCCESSIVE_ROI_DRAGS: ReadonlyArray<{ start: ImagePixel; end: ImagePixel }> = [
  { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  { start: { x: 2, y: 0 }, end: { x: 3, y: 1 } },
  { start: { x: 0, y: 2 }, end: { x: 1, y: 3 } },
  { start: { x: 2, y: 2 }, end: { x: 3, y: 3 } },
  { start: { x: 1, y: 1 }, end: { x: 2, y: 2 } },
];

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
  await activateRegionTool(launched.window);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("drawing an ROI shows Region stats matching the drawn rectangle and re-tracks on redraw", async () => {
  await drawRoi(SUB_REGION_TOP_LEFT, SUB_REGION_BOTTOM_RIGHT);
  await expect(regionSection(launched.window)).toBeVisible();
  await expectRegionStatsToSettle({ corners: "(1, 1) - (2, 2)", size: "2 x 2 px" });
  await drawRoi(FULL_REGION_TOP_LEFT, FULL_REGION_BOTTOM_RIGHT);
  await expectRegionStatsToSettle({ corners: "(0, 0) - (3, 3)", size: "4 x 4 px" });
  await expectExactlyOneCommittedRoi(launched.window, PANEL);
});

test("clicking outside the ROI removes the box and all markers", async () => {
  await drawRoi(SUB_REGION_TOP_LEFT, SUB_REGION_BOTTOM_RIGHT);
  await expectExactlyOneCommittedRoi(launched.window, PANEL);
  await plainClickImagePixel(launched.window, PANEL, OUTSIDE_PIXEL, SOURCE_DIMENSIONS);
  await expectNoCommittedRoiMarkers(launched.window, PANEL);
  await expect(regionSection(launched.window)).toHaveCount(0);
});

test("toggling off the region tool removes the box and all markers", async () => {
  await drawRoi(SUB_REGION_TOP_LEFT, SUB_REGION_BOTTOM_RIGHT);
  await expectExactlyOneCommittedRoi(launched.window, PANEL);
  await ensureRegionToolInactive(launched.window);
  await expectNoCommittedRoiMarkers(launched.window, PANEL);
  await expect(regionSection(launched.window)).toHaveCount(0);
});

test("drawing successive ROIs leaves exactly one box with one set of handles", async () => {
  for (const roi of SUCCESSIVE_ROI_DRAGS) {
    await drawRoi(roi.start, roi.end);
    await expectExactlyOneCommittedRoi(launched.window, PANEL);
  }
});

async function expectRegionStatsToSettle(expected: {
  corners: string;
  size: string;
}): Promise<void> {
  await expect.poll(() => readRegionStats(launched.window)).toEqual(expected);
}

async function drawRoi(startPixel: ImagePixel, endPixel: ImagePixel): Promise<void> {
  await drawInspectionRoiBetweenPixels(
    launched.window,
    PANEL,
    startPixel,
    endPixel,
    SOURCE_DIMENSIONS,
  );
}
