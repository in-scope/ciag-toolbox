import { expect, test } from "@playwright/test";

import { bimodalGrayPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  clickThresholdOtsuAutoButton,
  expectHistoryToRecordOperation,
  expectPixelReadoutToEqual,
  expectThresholdEditorReady,
  loadFixtureAsStack,
  openOperation,
  selectPanel,
  thresholdBoundField,
  THRESHOLD_OPERATION_LABEL,
} from "./support/page-objects";
import type { PixelDimensions } from "./support/page-objects";

// CT-201: the Auto button computes the Otsu cutoff. bimodal-gray.png is a 4x4
// uint8 fixture with a dark cluster 40..54 (indexes 0..7) and a bright cluster
// 200..214 (indexes 8..15) around a known empty valley; the generator pins the
// expected Otsu cutoff (55) in the manifest. Auto must set the bounds to
// [cutoff, 255], and Apply must then emit a binary stack where the dark
// cluster reads 0 and the bright cluster 255 via the pixel-readout oracle,
// with the audit trail recording the Otsu-derived cutoff.

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;
const FIXTURE = bimodalGrayPng;
const DIMENSIONS: PixelDimensions = { width: FIXTURE.width, height: FIXTURE.height };
const OTSU_CUTOFF = FIXTURE.expectedOtsuCutoff;
const UINT8_MAX = 255;
const WHITE = 255;
const BLACK = 0;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, FIXTURE.fileName);
  await selectPanel(launched.window, SOURCE_PANEL);
  await openOperation(launched.window, THRESHOLD_OPERATION_LABEL);
  await expectThresholdEditorReady(launched.window);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Auto sets the bounds to the manifest's pinned Otsu cutoff", async () => {
  await clickThresholdOtsuAutoButton(launched.window);
  await expect(thresholdBoundField(launched.window, "Lower")).toHaveValue(String(OTSU_CUTOFF));
  await expect(thresholdBoundField(launched.window, "Upper")).toHaveValue(String(UINT8_MAX));
});

test("applying the Otsu bounds splits the two clusters into a binary stack", async () => {
  await clickThresholdOtsuAutoButton(launched.window);
  await applyOperation(launched.window, THRESHOLD_OPERATION_LABEL);
  await expectResultReadout(0, 0, BLACK);
  await expectResultReadout(3, 1, BLACK);
  await expectResultReadout(0, 2, WHITE);
  await expectResultReadout(3, 3, WHITE);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: THRESHOLD_OPERATION_LABEL,
    detailSubstrings: ["Otsu", `band 1: ${OTSU_CUTOFF}`],
  });
});

// The dark cluster tops out at 54 and the bright cluster starts at 200, so
// with bounds [55, 255] the pixels below (0,0)/(3,1) go black and the pixels
// from (0,2) on go white.
async function expectResultReadout(imageX: number, imageY: number, expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: RESULT_PANEL,
    imageX,
    imageY,
    dimensions: DIMENSIONS,
    expected,
  });
}
