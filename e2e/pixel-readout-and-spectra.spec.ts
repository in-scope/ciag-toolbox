import { test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import type { FixtureSamplePixel } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  expectLiveHoverSpectrumVisible,
  expectNoLiveHoverSpectrum,
  expectPinnedSpectrumLineCount,
  expectPixelReadoutToEqual,
  hoverImagePixel,
  loadFixtureAsStack,
  pinPixelSpectrum,
} from "./support/page-objects";

// CT-133 / CT-037 / CT-038 / manual section 18: pixel readout and spectra.
//
// multiband-12bit.tif is a 3-band uint16 stack; after load the first band (index 0) is shown,
// so the status-bar readout reports that band's documented value at each hovered pixel.
//
// AC1: hovering a known pixel reports its TRUE value in the status bar (asserted against the
// fixture's documented sample pixels - integers, so exact).
// AC2: hovering a multi-band source draws a LIVE distinct/dashed spectrum line; clicking PINS
// it (solid) and the pinned line persists after the pointer leaves the image.

const PANEL = 1;
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const FIRST_BAND = 0;
const HOVER_PIXEL = { x: 1, y: 1 };

function firstBandValueOf(sample: FixtureSamplePixel): number {
  const value = sample.valuesPerBand[FIRST_BAND];
  if (value === undefined) throw new Error(`Sample pixel (${sample.x}, ${sample.y}) has no band 0 value`);
  return value;
}

test.describe("CT-133: pixel readout and spectra", () => {
  let launched: LaunchedApp;

  // Loading auto-selects the target panel, so the loaded stack is the active source for the
  // readout and Spectra section. A center-of-canvas selectPanel click is deliberately avoided
  // here: on a multi-band raster it would pin the centre pixel's spectrum before the test runs.
  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("hovering a known pixel reports its true value in the status bar", async () => {
    for (const sample of multiBandTiff.samplePixels) {
      await expectPixelReadoutToEqual(launched.window, {
        panel: PANEL,
        imageX: sample.x,
        imageY: sample.y,
        dimensions: DIMENSIONS,
        expected: firstBandValueOf(sample),
      });
    }
  });

  test("hovering draws a live dashed spectrum that pins solid and persists after the pointer leaves", async () => {
    await hoverImagePixel(launched.window, PANEL, HOVER_PIXEL.x, HOVER_PIXEL.y, DIMENSIONS);
    await expectLiveHoverSpectrumVisible(launched.window);
    await expectPinnedSpectrumLineCount(launched.window, 0);

    await pinPixelSpectrum(launched.window, PANEL, HOVER_PIXEL.x, HOVER_PIXEL.y, DIMENSIONS);

    await expectPinnedSpectrumLineCount(launched.window, 1);
    await expectNoLiveHoverSpectrum(launched.window);
  });
});
