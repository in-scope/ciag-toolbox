import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  applyOperationInPlace,
  drawInspectionRoiBetweenPixels,
  histogramSection,
  histogramValueAxisLabelsColumn,
  loadFixtureAsStack,
  openOperation,
  regionSection,
  selectActiveBandNumber,
  selectFullStackScope,
  selectPanel,
} from "./support/page-objects";

// CT-256: the right-panel Histogram follows the active Region box (matching the
// Spectra section's region mean), with a "Region" badge while scoped. CT-255's
// overlap rule is asserted here too: the float value-axis tick labels render
// with pairwise-disjoint bounding boxes.
//
// Fixture oracle (multiband-12bit.tif, value(band, i) = base + 10i over a 4x4
// ramp, bases 100/800/1600, cube min 100, span 1650): after Normalize (Min-max,
// Full stack) every value is (v - 100) / 1650, so band 3 spans 0.9091..1.000 at
// the 4-significant-figure float display. The region (0,0)-(2,2) excludes the
// band maximum at (3,3); its own maximum sits at (2,2) (ramp index 10, raw
// 1700) = 1600/1650 = 0.9697, so the max tick moving 1.000 -> 0.9697 proves the
// histogram re-binned ONLY the region's pixels, and float ranges follow the
// region extents. NOTE: the Region tool stays active until the Clear click -
// deactivating it clears the committed region (CT-155).

const PANEL = 1;
const NORMALIZE = "Normalize";
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };

const REGION_TOP_LEFT = { x: 0, y: 0 };
const REGION_BOTTOM_RIGHT = { x: 2, y: 2 };

const BAND_3 = 3;
const WHOLE_BAND_AXIS_LABELS = ["0.9091", "1.000"];
const REGION_AXIS_LABELS = ["0.9091", "0.9697"];

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Histogram follows the active region and restores the whole band on clear", async () => {
  const page = launched.window;

  await test.step("Normalize full stack to a float 0-1 panel and view band 3", async () => {
    await openOperation(page, NORMALIZE);
    await selectFullStackScope(page, NORMALIZE);
    await applyOperationInPlace(page, NORMALIZE);
    await selectActiveBandNumber(page, BAND_3);
  });

  await test.step("Whole-band histogram spans to 1.000 with no Region badge", async () => {
    await expect(histogramRegionBadge(page)).toHaveCount(0);
    await expectHistogramValueAxisLabels(page, WHOLE_BAND_AXIS_LABELS);
  });

  await test.step("Drawing a Region box scopes the histogram and shows the badge", async () => {
    await activateRegionTool(page);
    await drawInspectionRoiBetweenPixels(
      page,
      PANEL,
      REGION_TOP_LEFT,
      REGION_BOTTOM_RIGHT,
      DIMENSIONS,
    );
    await expect(histogramRegionBadge(page)).toBeVisible();
    await expectHistogramValueAxisLabels(page, REGION_AXIS_LABELS);
  });

  await test.step("Value-axis tick labels have pairwise-disjoint bounding boxes", async () => {
    await expectValueAxisTickLabelBoxesArePairwiseDisjoint(page);
  });

  await test.step("Clearing the region restores the whole-band histogram", async () => {
    await regionSection(page).getByRole("button", { name: "Clear" }).click();
    await expect(histogramRegionBadge(page)).toHaveCount(0);
    await expectHistogramValueAxisLabels(page, WHOLE_BAND_AXIS_LABELS);
  });
});

function histogramRegionBadge(page: Page) {
  return histogramSection(page).getByTestId("histogram-region-badge");
}

async function expectHistogramValueAxisLabels(
  page: Page,
  labels: ReadonlyArray<string>,
): Promise<void> {
  await expect(histogramValueAxisLabelsColumn(page).locator("span")).toHaveText([...labels]);
}

interface LabelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function expectValueAxisTickLabelBoxesArePairwiseDisjoint(page: Page): Promise<void> {
  const boxes = await collectValueAxisTickLabelBoxes(page);
  expect(boxes.length).toBeGreaterThanOrEqual(2);
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      expect(doLabelBoxesOverlap(boxes[a]!, boxes[b]!)).toBe(false);
    }
  }
}

async function collectValueAxisTickLabelBoxes(page: Page): Promise<LabelBox[]> {
  const spans = histogramValueAxisLabelsColumn(page).locator("span");
  const boxes: LabelBox[] = [];
  for (let index = 0; index < (await spans.count()); index += 1) {
    const box = await spans.nth(index).boundingBox();
    expect(box).not.toBeNull();
    boxes.push(box!);
  }
  return boxes;
}

function doLabelBoxesOverlap(a: LabelBox, b: LabelBox): boolean {
  const horizontallySeparate = a.x + a.width <= b.x || b.x + b.width <= a.x;
  const verticallySeparate = a.y + a.height <= b.y || b.y + b.height <= a.y;
  return !(horizontallySeparate || verticallySeparate);
}
