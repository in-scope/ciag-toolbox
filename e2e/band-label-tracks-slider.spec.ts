import { test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  expectPanelHeaderActiveBand,
  expectPanelHeaderNotToName,
  expectPanelHeaderToName,
  loadFixtureAsStack,
  removeDisplayedBand,
  selectActiveBandNumber,
  setActiveBandViaSlider,
  stepToNextBand,
  stepToPreviousBand,
} from "./support/page-objects";

// CT-153 / CT-094 / manual section 20: the top panel/file label tracks the band slider.
//
// multiband-12bit.tif is a 3-band uint16 stack with no explicit band labels, so the header
// names the displayed band as "Band <originalNumber>" (formatViewportHeaderLabel). The
// contract: every path that changes the displayed band (slider, numeric input, prev/next)
// updates the label in real time, and removing the displayed band cannot leave the label
// naming a band that no longer exists.

const PANEL = 1;
const FILE = multiBandTiff.fileName;

function headerForBand(bandNumber: number): string {
  return `${FILE} - Band ${bandNumber}`;
}

test.describe("CT-153: top label tracks every band-selection gesture", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, FILE);
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("numeric input, prev/next, and the slider all update the label", async () => {
    const { window } = launched;
    await expectPanelHeaderToName(window, PANEL, headerForBand(1));

    await selectActiveBandNumber(window, 2);
    await expectPanelHeaderToName(window, PANEL, headerForBand(2));
    await selectActiveBandNumber(window, 3);
    await expectPanelHeaderToName(window, PANEL, headerForBand(3));

    await stepToPreviousBand(window);
    await expectPanelHeaderToName(window, PANEL, headerForBand(2));
    await stepToNextBand(window);
    await expectPanelHeaderToName(window, PANEL, headerForBand(3));

    await setActiveBandViaSlider(window, 1);
    await expectPanelHeaderToName(window, PANEL, headerForBand(1));
  });
});

test.describe("CT-153: removing the displayed band leaves no stale label", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, FILE);
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("the label reflects the now-displayed band, never the removed one", async () => {
    const { window } = launched;
    await selectActiveBandNumber(window, 2);
    await expectPanelHeaderToName(window, PANEL, headerForBand(2));

    await removeDisplayedBand(window, 2);

    // Kept original bands [1, 3]; the selection resets to index 0 (original band 1), so the
    // label must now end in "Band 1" and never name the removed "Band 2".
    await expectPanelHeaderActiveBand(window, PANEL, 1);
    await expectPanelHeaderNotToName(window, PANEL, "Band 2");
  });
});
