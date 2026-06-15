import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import type { PixelDimensions, ToneCurveAnchorPoint, ToneCurveValueRanges } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  addToneCurveAnchorAtFraction,
  applicationToolbar,
  applyOperationInPlace,
  clickToneCurveAnchorHandle,
  clickToneCurveResetToIdentity,
  dragToneCurveEndpointTo,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  expectToneCurveOpensWithTwoEndpoints,
  historyEntryCount,
  loadFixtureAsStack,
  nonClearPixelFraction,
  nudgeSelectedToneCurveAnchor,
  openOperation,
  panelCanvas,
  readPixelValueAt,
  readToneCurveAnchors,
  selectOperationRegionByDrag,
  selectPanel,
  selectRegionOfInterestScope,
  setToneCurveAnchorField,
  summarizeCanvasPixels,
  toneCurveEndpointHandles,
  toneCurveInteriorHandles,
  TONE_CURVE_LABEL,
} from "./support/page-objects";

// CT-139 / manual sections 6, 24, 25 (CT-080, CT-098, CT-099): the tone-curve editor.
// The editor opens over the band histogram with two endpoint anchors; with exactly two
// anchors the engine degenerates to a straight line, so the result is a linear black/white
// stretch out = (in - B)/(W - B) * (Wout - Bout) + Bout (CT-080). Adding/dragging anchors
// updates the viewport preview live before Apply; Apply commits data + a History entry. With
// "Region of interest" scope the remap touches only the requested region.
//
// FIXTURE SUBSTITUTION (no E2E-BUG): the manual uses low-contrast-sample.png. A PNG loads as an
// image-bitmap and, when an operation runs, is auto-promoted (CT-109) to an 8-bit 3-band RGB
// raster, so it CAN be tone-curved; but its values are then an 8-bit RGB decode, not a controlled
// oracle. The raster fixture multiband-12bit.tif is used instead (band 0 = 100 + (y*4 + x)*10).
//
// IDENTITY DEFAULT (no E2E-BUG): for an integer band the histogram X axis spans the data-TYPE
// range (uint16 0..65535, compute-band-histogram.ts), so the default endpoints (0,0)-(65535,
// 65535) are the identity line. A meaningful stretch comes from dragging the endpoints; the
// exact oracle reads the resulting anchors back from the DOM rather than trusting sub-pixel
// drag accuracy (band 0's 100..250 spans <0.4% of the input axis). Dragging an endpoint OUT
// of the editor clamps to an exact edge value (e.g. above-left -> exactly (0, 65535)).

const PANEL = 1;
const UINT16 = "uint16";
const FOUR_BY_FOUR: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const UINT16_TYPE_MAX = 65535;
const UINT16_RANGES: ToneCurveValueRanges = {
  inputMin: 0,
  inputMax: UINT16_TYPE_MAX,
  outputMin: 0,
  outputMax: UINT16_TYPE_MAX,
};

let launched: LaunchedApp;

function bandZeroValueAt(x: number, y: number): number {
  return 100 + (y * multiBandTiff.width + x) * 10;
}

// The definition of a linear black/white stretch through endpoints (B, Bout) and (W, Wout),
// computed independently of the app so a non-linear result would fail the assertion.
function linearStretchOf(value: number, black: ToneCurveAnchorPoint, white: ToneCurveAnchorPoint): number {
  if (value <= black.input) return Math.round(black.output);
  if (value >= white.input) return Math.round(white.output);
  const slope = (white.output - black.output) / (white.input - black.input);
  return Math.round(black.output + (value - black.input) * slope);
}

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("opens with two endpoint anchors and the 2-anchor case is the linear black/white stretch", async () => {
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await dragToneCurveEndpointTo(launched.window, "right", 0.5, -0.2);
  const [black, white] = await readToneCurveAnchors(launched.window, UINT16_RANGES);
  await applyOperationInPlace(launched.window, TONE_CURVE_LABEL);
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: 4, height: 4 });
  await expectStretchedReadout({ x: 0, y: 0 }, black!, white!);
  await expectStretchedReadout({ x: 1, y: 0 }, black!, white!);
  await expectStretchedReadout({ x: 3, y: 3 }, black!, white!);
});

test("adding/dragging anchors updates the viewport preview live and Apply changes data + records History", async () => {
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  const darkUnderIdentity = await waitForPreviewFractionToSettle();
  await dragToneCurveEndpointTo(launched.window, "left", -0.2, -0.2);
  await expectPreviewBrightenedAbove(darkUnderIdentity);
  await addToneCurveAnchorAtFraction(launched.window, 0.5, 0.5);
  expect(await historyEntryCount(launched.window)).toBe(0);
  await applyThreeAnchorCurveAndAssertHistory();
  await expectDarkPixelLiftedTowardWhite({ x: 0, y: 0 });
});

test("region-of-interest scope remaps only pixels inside the requested region", async () => {
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await dragToneCurveEndpointTo(launched.window, "left", -0.2, -0.2);
  await selectRegionOfInterestScope(launched.window, TONE_CURVE_LABEL);
  await selectRegion({ x: 0, y: 0 }, { x: 1, y: 1 });
  await applyOperationInPlace(launched.window, TONE_CURVE_LABEL);
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: 4, height: 4 });
  await expectExactReadout({ x: 1, y: 1 }, UINT16_TYPE_MAX);
  await expectExactReadout({ x: 3, y: 3 }, bandZeroValueAt(3, 3));
});

test("exposes no separate standalone black/white-marker UI", async () => {
  await expectNoBlackWhitePointUiOnPage();
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await expectNoBlackWhitePointUiOnPage();
});

// CT-169 consolidated regression: a single realistic edit chain that touches every GIMP-parity
// control added in CT-164..168 (add an anchor, place it numerically via the Input/Output fields,
// nudge it with the keyboard, then Reset) and asserts an APPLIED-pixel outcome - not just DOM.
// Reset returns the curve to identity, so the resulting curve maps every pixel to itself.
test("a realistic edit chain (add, fields, nudge, reset) applies the identity curve unchanged", async () => {
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await addNumericallyPlacedAnchorThenNudgeIt();
  await clickToneCurveResetToIdentity(launched.window);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await applyOperationInPlace(launched.window, TONE_CURVE_LABEL);
  await expectIdentityAppliedOutcome();
});

// A numerically-placed endpoint plus a keyboard nudge produces a real (non-identity) curve, and
// the applied pixels match the exact stretch computed from the anchors read back from the DOM.
test("a numeric Output edit plus a keyboard nudge applies the exact resulting curve", async () => {
  await openOperation(launched.window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(launched.window);
  await setToneCurveAnchorField(launched.window, "Output", UINT16_TYPE_MAX);
  await clickToneCurveAnchorHandle(toneCurveEndpointHandles(launched.window).first());
  await nudgeSelectedToneCurveAnchor(launched.window, "down");
  const [black, white] = await readToneCurveAnchors(launched.window, UINT16_RANGES);
  await applyOperationInPlace(launched.window, TONE_CURVE_LABEL);
  await expectStretchedReadout({ x: 0, y: 0 }, black!, white!);
  await expectStretchedReadout({ x: 3, y: 3 }, black!, white!);
});

// Adds an interior anchor, places it with the numeric fields, then nudges it one step. Clicking
// the handle before the nudge re-focuses the editor (a field commit leaves focus in the input).
async function addNumericallyPlacedAnchorThenNudgeIt(): Promise<void> {
  await addToneCurveAnchorAtFraction(launched.window, 0.5, 0.5);
  await clickToneCurveAnchorHandle(toneCurveInteriorHandles(launched.window).first());
  await setToneCurveAnchorField(launched.window, "Input", 30000);
  await setToneCurveAnchorField(launched.window, "Output", 40000);
  await clickToneCurveAnchorHandle(toneCurveInteriorHandles(launched.window).first());
  await nudgeSelectedToneCurveAnchor(launched.window, "right");
}

async function expectIdentityAppliedOutcome(): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: UINT16, width: 4, height: 4 });
  await expectExactReadout({ x: 0, y: 0 }, bandZeroValueAt(0, 0));
  await expectExactReadout({ x: 3, y: 3 }, bandZeroValueAt(3, 3));
}

async function applyThreeAnchorCurveAndAssertHistory(): Promise<void> {
  await applyOperationInPlace(launched.window, TONE_CURVE_LABEL);
  expect(await historyEntryCount(launched.window)).toBe(1);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: TONE_CURVE_LABEL,
    detailSubstrings: ["3 points"],
  });
}

async function expectStretchedReadout(
  pixel: { x: number; y: number },
  black: ToneCurveAnchorPoint,
  white: ToneCurveAnchorPoint,
): Promise<void> {
  await expectExactReadout(pixel, linearStretchOf(bandZeroValueAt(pixel.x, pixel.y), black, white));
}

async function expectExactReadout(pixel: { x: number; y: number }, expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: pixel.x,
    imageY: pixel.y,
    dimensions: FOUR_BY_FOUR,
    expected,
  });
}

// Pulling the black point up to the top edge lifts every value toward white, so a dark pixel
// reads far above its raw value (the data was remapped, not merely re-displayed).
async function expectDarkPixelLiftedTowardWhite(pixel: { x: number; y: number }): Promise<void> {
  const raw = bandZeroValueAt(pixel.x, pixel.y);
  const readout = await readPixelValueAt(launched.window, PANEL, pixel.x, pixel.y, FOUR_BY_FOUR);
  const value = Number.parseFloat(readout.value);
  expect(value).not.toBe(raw);
  expect(value).toBeGreaterThan(30000);
}

async function waitForPreviewFractionToSettle(): Promise<number> {
  await launched.window.waitForTimeout(200);
  return panelNonClearFraction();
}

async function expectPreviewBrightenedAbove(baselineFraction: number): Promise<void> {
  await expect.poll(() => panelNonClearFraction()).toBeGreaterThan(baselineFraction + 0.1);
}

function panelNonClearFraction(): Promise<number> {
  return summarizeCanvasPixels(panelCanvas(launched.window, PANEL)).then(nonClearPixelFraction);
}

async function selectRegion(start: { x: number; y: number }, end: { x: number; y: number }): Promise<void> {
  await selectOperationRegionByDrag(launched.window, {
    panelNumber: PANEL,
    operationLabel: TONE_CURVE_LABEL,
    startPixel: start,
    endPixel: end,
    imageDimensions: FOUR_BY_FOUR,
  });
}

async function expectNoBlackWhitePointUiOnPage(): Promise<void> {
  await expect(launched.window.getByText(/black[\s-]?point/i)).toHaveCount(0);
  await expect(launched.window.getByText(/white[\s-]?point/i)).toHaveCount(0);
  await expect(applicationToolbar(launched.window).getByRole("button", { name: /black|white/i })).toHaveCount(0);
}
