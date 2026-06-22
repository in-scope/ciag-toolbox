import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  isApplyEnabled,
  loadFixtureAsStack,
  openOperation,
  selectActiveBandNumber,
  selectFullStackScope,
  setOperationEnumParameter,
  setOperationNumberParameter,
} from "./support/page-objects";

// CT-194: the Normalize op's "Clip by value (absolute)" method clamps each value to an
// absolute [lo, hi] range instead of rescaling to [0,1]. It is data-changing but TYPE- and
// in-range-PRESERVING (only the known bad highs/lows move to the bounds), so the output stays
// uint16. multiband-12bit.tif documents band 2 (0,0)=800 / (3,3)=950 and band 3 (0,0)=1600 /
// (3,3)=1750. A full-stack clip to [850, 1700] therefore: clamps the band-2 low (800->850),
// leaves the band-2 (3,3)=950 in-range value untouched, and clamps the band-3 high (1750->1700).

const PANEL = 1;
const NORMALIZE = "Normalize";
const CLIP_BY_VALUE = "clip-absolute";
const CLIP_LOW = "Clip low";
const CLIP_HIGH = "Clip high";
const UINT16 = "uint16";
const CLIP_LOW_VALUE = 850;
const CLIP_HIGH_VALUE = 1700;
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const READOUT_TOLERANCE = 0.5;
const TOP_LEFT = { x: 0, y: 0 };
const BOTTOM_RIGHT = { x: 3, y: 3 };

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Clip by value clamps out-of-range pixels to the bounds and leaves in-range pixels unchanged", async () => {
  await applyFullStackClip(CLIP_LOW_VALUE, CLIP_HIGH_VALUE);

  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: UINT16,
    width: multiBandTiff.width,
    height: multiBandTiff.height,
  });
  await expectActiveBandReadout(2, TOP_LEFT, CLIP_LOW_VALUE); // 800 clamps up to the low bound
  await expectActiveBandReadout(2, BOTTOM_RIGHT, 950); // in [850, 1700], unchanged
  await expectActiveBandReadout(3, BOTTOM_RIGHT, CLIP_HIGH_VALUE); // 1750 clamps down to the high bound
});

test("Clip by value records the method and the lo/hi bounds in History", async () => {
  await applyFullStackClip(CLIP_LOW_VALUE, CLIP_HIGH_VALUE);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: NORMALIZE,
    detailSubstrings: [`Clip to [${CLIP_LOW_VALUE}, ${CLIP_HIGH_VALUE}]`, "full stack"],
  });
});

test("Clip by value disables Apply until the high bound exceeds the low bound", async () => {
  await openOperation(launched.window, NORMALIZE);
  await setOperationEnumParameter(launched.window, NORMALIZE, CLIP_BY_VALUE);
  await setOperationNumberParameter(launched.window, NORMALIZE, CLIP_LOW, 900);
  await setOperationNumberParameter(launched.window, NORMALIZE, CLIP_HIGH, 800);
  expect(await isApplyEnabled(launched.window, NORMALIZE)).toBe(false);

  await setOperationNumberParameter(launched.window, NORMALIZE, CLIP_HIGH, 1000);
  expect(await isApplyEnabled(launched.window, NORMALIZE)).toBe(true);
});

async function applyFullStackClip(lo: number, hi: number): Promise<void> {
  await openOperation(launched.window, NORMALIZE);
  await setOperationEnumParameter(launched.window, NORMALIZE, CLIP_BY_VALUE);
  await selectFullStackScope(launched.window, NORMALIZE);
  await setOperationNumberParameter(launched.window, NORMALIZE, CLIP_LOW, lo);
  await setOperationNumberParameter(launched.window, NORMALIZE, CLIP_HIGH, hi);
  await applyOperationInPlace(launched.window, NORMALIZE);
}

async function expectActiveBandReadout(
  oneBasedBandNumber: number,
  pixel: { x: number; y: number },
  expected: number,
): Promise<void> {
  await selectActiveBandNumber(launched.window, oneBasedBandNumber);
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: pixel.x,
    imageY: pixel.y,
    dimensions: DIMENSIONS,
    expected,
    tolerance: READOUT_TOLERANCE,
  });
}
