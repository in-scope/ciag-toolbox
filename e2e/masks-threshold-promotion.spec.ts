import { expect, test } from "@playwright/test";
import { join } from "node:path";

import { bimodalGrayPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  clickPanelToSelect,
  createMaskLayer,
  createTemporaryExportDirectory,
  exportSelectedMaskAndDecodeIndexPng,
  loadFixtureAsStack,
  noQualifyingThresholdResultHint,
  openMasksOptions,
  openOperation,
  promoteFirstQualifyingThresholdResult,
  selectPanel,
  selectThresholdMethod,
  sourcePanelMenuTrigger,
  THRESHOLD_OPERATION_LABEL,
} from "./support/page-objects";

// CT-305: promoting a Threshold result into a mask category. bimodal-gray.png
// pins its Otsu cutoff at 55, splitting the dark cluster (indexes 0..7,
// values 40..54) to black and the bright cluster (indexes 8..15, values
// 200..214) to white; the promotion must carry exactly the white pixels into
// the currently selected category (defaults to category 1, "Foreground"),
// leaving the rest unlabeled, verified by decoding the exported mask.

const SOURCE_PANEL = 1;
const FIXTURE = bimodalGrayPng;
const FOREGROUND_CATEGORY_VALUE = 1;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, FIXTURE.fileName);
  await selectPanel(launched.window, SOURCE_PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("offers no promotion source before a qualifying threshold result exists", async () => {
  const page = launched.window;
  await openMasksOptions(page);
  await createMaskLayer(page);
  await expect(noQualifyingThresholdResultHint(page)).toBeVisible();
  await expect(sourcePanelMenuTrigger(page)).toHaveCount(0);
});

test("promotes the white pixels of a threshold result into the selected category", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await createMaskLayer(page);

  await openOperation(page, THRESHOLD_OPERATION_LABEL);
  await selectThresholdMethod(page, "Otsu threshold");
  await applyOperation(page, THRESHOLD_OPERATION_LABEL);

  // The Masks tool is still active with the new layer selected, so a plain
  // centred click on the panel would land on the canvas and paint a brush
  // stroke instead of just selecting it; click the cell's corner strip like
  // the multi-select helper does.
  await clickPanelToSelect(page, SOURCE_PANEL);
  await promoteFirstQualifyingThresholdResult(page);

  const exportPath = join(await createTemporaryExportDirectory(), "promoted-mask.zip");
  const decoded = await exportSelectedMaskAndDecodeIndexPng(page, exportPath);

  expect({ width: decoded.width, height: decoded.height, channels: decoded.channels }).toEqual({
    width: FIXTURE.width,
    height: FIXTURE.height,
    channels: 1,
  });
  expect(decoded.values).toEqual(expectedPromotedMaskValues());
});

// The dark cluster (indexes 0..7) sits below the pinned Otsu cutoff (55) and
// stays unlabeled; the bright cluster (indexes 8..15) crosses it and reads
// white in the threshold result, so it takes the selected category.
function expectedPromotedMaskValues(): number[] {
  return Array.from({ length: FIXTURE.width * FIXTURE.height }, (_, index) =>
    index < 8 ? 0 : FOREGROUND_CATEGORY_VALUE,
  );
}
