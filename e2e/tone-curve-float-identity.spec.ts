import { expect, test } from "@playwright/test";

import { enviFloatStack } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { nonClearPixelFraction, summarizeCanvasPixels } from "./support/canvas-pixels";
import {
  loadFixtureAsStack,
  openOperation,
  panelCanvas,
  readPixelValueAt,
  TONE_CURVE_LABEL,
  type PixelDimensions,
} from "./support/page-objects";

// CT-198: opening the Tone Curve panel must leave a float band looking EXACTLY the same
// until the user moves a node (matching the integer case and GIMP). The default two-endpoint
// curve is now a true identity in the data domain, and the preview LUT/shader sample the
// curve over the band's own value range, so a float band whose values straddle [0,1] is not
// silently restretched on open. The fixture's displayed band 0 is mostly -1.0 (renders black
// under the auto-fit window) with four +1.5 pixels (white). On main the float stretch lifts
// the negatives off black, so the non-clear fraction jumps when the panel opens; after the
// fix the canvas is unchanged. Display-only: the (0,0) data readout stays -1.0 throughout.

const PANEL = 1;
const FIXTURE_DIMENSIONS: PixelDimensions = {
  width: enviFloatStack.width,
  height: enviFloatStack.height,
};
const ORIGIN_BAND0_VALUE = enviFloatStack.samplePixels[0]!.valuesPerBand[0]!; // -1.0
const UNCHANGED_FRACTION_TOLERANCE = 0.1;

test("opening the Tone Curve panel on a float band does not restretch the display or the data", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, enviFloatStack.headerFileName);
    const fractionBeforeOpen = await readPanelNonClearFraction(app, PANEL);
    const originBeforeOpen = await readOriginBand0Readout(app, PANEL);
    expect(Number.parseFloat(originBeforeOpen)).toBeCloseTo(ORIGIN_BAND0_VALUE, 4);

    await openOperation(app.window, TONE_CURVE_LABEL);
    await expectPanelFractionToStayCloseTo(app, PANEL, fractionBeforeOpen);
    expect(await readOriginBand0Readout(app, PANEL)).toBe(originBeforeOpen);
  } finally {
    await closeToolboxApp(app);
  }
});

async function readPanelNonClearFraction(app: LaunchedApp, panelNumber: number): Promise<number> {
  return nonClearPixelFraction(await summarizeCanvasPixels(panelCanvas(app.window, panelNumber)));
}

async function readOriginBand0Readout(app: LaunchedApp, panelNumber: number): Promise<string> {
  const readout = await readPixelValueAt(app.window, panelNumber, 0, 0, FIXTURE_DIMENSIONS);
  return readout.value;
}

async function expectPanelFractionToStayCloseTo(
  app: LaunchedApp,
  panelNumber: number,
  expectedFraction: number,
): Promise<void> {
  const canvas = panelCanvas(app.window, panelNumber);
  await expect
    .poll(async () => Math.abs(nonClearPixelFraction(await summarizeCanvasPixels(canvas)) - expectedFraction))
    .toBeLessThan(UNCHANGED_FRACTION_TOLERANCE);
}
