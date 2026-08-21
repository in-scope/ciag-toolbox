import { expect, test } from "@playwright/test";

import { rgbaTiff } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { loadFixtureAsStack, panelCanvas, panelCell, selectPanel } from "./support/page-objects";
import { colorfulNonClearPixelFraction } from "./support/canvas-pixels";
import { selectActiveBandNumber } from "./support/band-navigator";
import { readPixelValueAt } from "./support/pixel-readout";
import { toggleChannelView } from "./support/channel-view";

// CT-288: colour TIFF variants open in colour regardless of how the exporter wrote
// them. This spec drives the RGBA variant (rgba.tif: photometric RGB, 4 samples per
// pixel with an extra-samples alpha) end to end: it must open as ONE colour image
// (RGB composite render, no band navigator) with the alpha dropped and the exact
// rgb.png pixel colours preserved. The render oracle is colorfulNonClearPixelFraction
// (the CT-159 distinct-colour detector); the data oracle is the status-bar pixel
// readout at (0,0)=(200,100,50), read per channel through the CT-248 channel view.
// The palette-colour and missing-photometric variants are pinned by the load-tiff
// unit tests against the same committed fixtures.

const PANEL = 1;
const DIMENSIONS: PixelDimensions = { width: rgbaTiff.width, height: rgbaTiff.height };
const PROBE = rgbaTiff.samplePixels[0]!;
const PROBE_BAND_LABELS = ["#1 Red", "#2 Green", "#3 Blue"];
const COMPOSITE_MIN_COLORFUL_FRACTION = 0.4;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("an RGBA TIFF opens as one colour image with its exact RGB values and no band navigator", async () => {
  await test.step("open rgba.tif", async () => {
    await loadFixtureAsStack(launched.window, rgbaTiff.fileName);
    await selectPanel(launched.window, PANEL);
  });
  await test.step("it renders as one colour composite with no band navigator", async () => {
    await expect(bandNavigator()).toHaveCount(0);
    await expect
      .poll(() => colorfulNonClearPixelFraction(panelCanvas(launched.window, PANEL)))
      .toBeGreaterThan(COMPOSITE_MIN_COLORFUL_FRACTION);
  });
  await test.step("the channel view reads the probe pixel's exact R, G, and B values", async () => {
    await toggleChannelView(launched.window, PANEL);
    for (const bandNumber of [1, 2, 3]) {
      await selectActiveBandNumber(launched.window, bandNumber);
      await expectProbeReadout(bandNumber);
    }
  });
});

function bandNavigator() {
  return panelCell(launched.window, PANEL).getByTestId("viewport-band-navigator");
}

async function expectProbeReadout(bandNumber: number): Promise<void> {
  await expect
    .poll(async () => {
      const readout = await readPixelValueAt(launched.window, PANEL, PROBE.x, PROBE.y, DIMENSIONS);
      return `${readout.bandLabel} = ${readout.value}`;
    })
    .toBe(`${PROBE_BAND_LABELS[bandNumber - 1]} = ${PROBE.valuesPerBand[bandNumber - 1]}`);
}
