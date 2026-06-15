import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  dragMouseFromTo,
  drawInspectionRoiBetweenPixels,
  ensureRegionToolInactive,
  expectExactlyOneCommittedRoi,
  expectNoCommittedRoiMarkers,
  loadFixtureAsStack,
  panelCanvasCenter,
  plainClickImagePixel,
  regionSection,
  selectPanel,
  wheelAtPagePoint,
  type ImagePixel,
} from "./support/page-objects";

// CT-155 / manual section 22 (CT-096): clear ROI and no persisting selection markers.
//   AC1 - clicking outside the ROI, or deselecting the region tool, removes the box and its
//   markers (manual 22.1 / 22.2).
//   AC2 - drawing five ROIs in a row leaves exactly one box with one set of handles at all
//   times (manual 22.3), and panning/zooming after clearing shows no ghost markers at any zoom
//   level (manual 22.4 - the lifecycle-hygiene check CT-132 did not cover).
// A committed ROI overlay is exactly one dashed border rect plus four corner-handle squares
// (expectExactlyOneCommittedRoi); a cleared ROI unmounts the whole overlay and the Region
// section (expectNoCommittedRoiMarkers), so an accumulation or ghost-marker bug is read
// straight from the DOM marker counts.

const PANEL = 1;
const SOURCE_DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };

const SUB_REGION_TOP_LEFT: ImagePixel = { x: 1, y: 1 };
const SUB_REGION_BOTTOM_RIGHT: ImagePixel = { x: 2, y: 2 };
const OUTSIDE_PIXEL: ImagePixel = { x: 3, y: 3 };

const WHEEL_STEP_DELTA = 1000;
const PAN_OFFSET = { x: 60, y: 40 };

// Five non-overlapping 2x2 ROIs across the 4x4 fixture; each drag exceeds the commit
// threshold and sits in a distinct place, so an accumulation bug would strand stray handles.
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

test("clicking outside the ROI removes the box and all markers", async () => {
  await drawRoi(SUB_REGION_TOP_LEFT, SUB_REGION_BOTTOM_RIGHT);
  await expectExactlyOneCommittedRoi(launched.window, PANEL);
  await plainClickImagePixel(launched.window, PANEL, OUTSIDE_PIXEL, SOURCE_DIMENSIONS);
  await expectNoCommittedRoiMarkers(launched.window, PANEL);
  await expect(regionSection(launched.window)).toHaveCount(0);
});

test("deselecting the region tool removes the box and all markers", async () => {
  await drawRoi(SUB_REGION_TOP_LEFT, SUB_REGION_BOTTOM_RIGHT);
  await expectExactlyOneCommittedRoi(launched.window, PANEL);
  await ensureRegionToolInactive(launched.window);
  await expectNoCommittedRoiMarkers(launched.window, PANEL);
  await expect(regionSection(launched.window)).toHaveCount(0);
});

test("drawing five ROIs in a row leaves exactly one box with one set of handles at all times", async () => {
  for (const roi of SUCCESSIVE_ROI_DRAGS) {
    await drawRoi(roi.start, roi.end);
    await expectExactlyOneCommittedRoi(launched.window, PANEL);
  }
});

test("panning and zooming after clearing shows no ghost markers at any zoom level", async () => {
  const page = launched.window;
  await drawRoi(SUB_REGION_TOP_LEFT, SUB_REGION_BOTTOM_RIGHT);
  await expectExactlyOneCommittedRoi(page, PANEL);
  await ensureRegionToolInactive(page);
  await expectNoCommittedRoiMarkers(page, PANEL);
  await expectNoMarkersThroughPanAndZoom(page);
});

async function expectNoMarkersThroughPanAndZoom(page: LaunchedApp["window"]): Promise<void> {
  const center = await panelCanvasCenter(page, PANEL);
  await zoomThenAssertNoMarkers(page, center, -WHEEL_STEP_DELTA, 4);
  await panThenAssertNoMarkers(page, center);
  await zoomThenAssertNoMarkers(page, center, -WHEEL_STEP_DELTA, 30);
  await zoomThenAssertNoMarkers(page, center, WHEEL_STEP_DELTA, 40);
}

async function zoomThenAssertNoMarkers(
  page: LaunchedApp["window"],
  center: { x: number; y: number },
  deltaY: number,
  wheelEventCount: number,
): Promise<void> {
  await wheelAtPagePoint(page, center, deltaY, wheelEventCount);
  await expectNoCommittedRoiMarkers(page, PANEL);
}

async function panThenAssertNoMarkers(
  page: LaunchedApp["window"],
  center: { x: number; y: number },
): Promise<void> {
  await dragMouseFromTo(page, center, { x: center.x + PAN_OFFSET.x, y: center.y + PAN_OFFSET.y });
  await expectNoCommittedRoiMarkers(page, PANEL);
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
