import { expect, test } from "@playwright/test";

import { enviFloatStack } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  loadFixtureAsStack,
  openOperation,
  readPixelValueAt,
  selectActiveBandNumber,
  setToneCurveAnchorField,
  toneCurveAnchorField,
  TONE_CURVE_LABEL,
  type PixelDimensions,
} from "./support/page-objects";

// CT-199: the selected endpoint's Input field is now EDITABLE (GIMP black/white-point semantics),
// not disabled. Moving the left endpoint Input inward sets a black point: source pixels below it
// clip to the output floor while the curve preserves the band maximum at the right endpoint.
//
// The fixture's displayed band 0 has only the two extreme values (-1.0 / +1.5), where the output
// floor equals the dark value, so any black-point clip there is vacuous. Band 2 (1-based) is a
// linear ramp from -0.5 to 1.3 with intermediate values, so a black point at 0.30 produces a REAL,
// observable clip: a mid-ramp pixel below 0.30 drops to the floor (-0.5) while the band maximum
// (1.30, the right endpoint) is preserved.

const PANEL = 1;
const RAMP_BAND_NUMBER = 2; // 1-based; band index 1 is buildFloatRampBand(-0.5, 0.12)
const FIXTURE_DIMENSIONS: PixelDimensions = {
  width: enviFloatStack.width,
  height: enviFloatStack.height,
};

const BLACK_POINT_INPUT = 0.3;
const RAMP_OUTPUT_FLOOR = -0.5; // the ramp band's minimum, and the left endpoint's output
const RAMP_MAXIMUM = 1.3; // the ramp band's maximum, preserved at the right endpoint
const VALUE_TOLERANCE_DIGITS = 3;

// (2,1) holds 0.22 (= -0.5 + 6*0.12), below the 0.30 black point -> clipped to the floor.
const BELOW_BLACK_POINT_PIXEL = { x: 2, y: 1 };
// (3,3) holds 1.30 (the ramp maximum), the right endpoint -> preserved unchanged.
const PRESERVED_MAXIMUM_PIXEL = { x: 3, y: 3 };

test("editing the left endpoint Input sets a black point that clips low pixels and preserves the maximum", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFixtureAsStack(app.window, enviFloatStack.headerFileName);
    await selectActiveBandNumber(app.window, RAMP_BAND_NUMBER);
    await openOperation(app.window, TONE_CURVE_LABEL);

    await expect(toneCurveAnchorField(app.window, "Input")).not.toBeDisabled();
    await setToneCurveAnchorField(app.window, "Input", BLACK_POINT_INPUT);
    await applyOperationInPlace(app.window, TONE_CURVE_LABEL);

    await selectActiveBandNumber(app.window, RAMP_BAND_NUMBER);
    await expectRampPixelValueToBeCloseTo(app, BELOW_BLACK_POINT_PIXEL, RAMP_OUTPUT_FLOOR);
    await expectRampPixelValueToBeCloseTo(app, PRESERVED_MAXIMUM_PIXEL, RAMP_MAXIMUM);
  } finally {
    await closeToolboxApp(app);
  }
});

async function expectRampPixelValueToBeCloseTo(
  app: LaunchedApp,
  pixel: { x: number; y: number },
  expectedValue: number,
): Promise<void> {
  const readout = await readPixelValueAt(app.window, PANEL, pixel.x, pixel.y, FIXTURE_DIMENSIONS);
  expect(Number.parseFloat(readout.value)).toBeCloseTo(expectedValue, VALUE_TOLERANCE_DIGITS);
}
