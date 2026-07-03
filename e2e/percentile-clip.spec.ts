import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  countPanels,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  loadFixtureAsStack,
  openOperation,
  readMetadata,
  selectBandWiseScopeForBands,
  selectPanel,
  setOperationNumberParameter,
  type PixelDimensions,
} from "./support/page-objects";

// CT-205: the Percentile clip operation clamps stack values to percentile cut
// points (np.clip semantics) and outputs a NEW float32 stack in a fresh panel.
// multiband-12bit.tif is three 16-value ramps stepping by 10 (100..250,
// 800..950, 1600..1750), so the numpy-style linear percentile cut points are
// exact oracles:
// - full stack over the 48 concatenated values with 2/30 percentiles: lower
//   rank 0.02 * 47 = 0.94 -> 109.4, upper rank 0.30 * 47 = 14.1 -> 241, so
//   band 1 reads 109.4 at (0,0) (raised), 241 at (3,3) (lowered), and an
//   in-window pixel keeps its source value.
// - band-wise on band 1 alone with the default 2/98 percentiles: lower rank
//   0.02 * 15 = 0.3 -> 103, upper rank 0.98 * 15 = 14.7 -> 247.

const PERCENTILE_CLIP = "Percentile Clip";
const RESULT_PANEL = 2;
const FLOAT32 = "float32";
const FIXTURE = multiBandTiff;
const DIMENSIONS: PixelDimensions = { width: FIXTURE.width, height: FIXTURE.height };
const FLOAT_READOUT_TOLERANCE = 0.001;

const UPPER_PERCENTILE_LABEL = "Upper percentile";

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, FIXTURE.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("full stack clips every band to one whole-stack cut-point pair", async () => {
  await openOperation(launched.window, PERCENTILE_CLIP);
  await setOperationNumberParameter(launched.window, PERCENTILE_CLIP, UPPER_PERCENTILE_LABEL, 30);
  await applyOperation(launched.window, PERCENTILE_CLIP);

  await expectResultIsFullSizeFloat32Stack();
  await expectResultBandOneReadout({ x: 0, y: 0 }, 109.4);
  await expectResultBandOneReadout({ x: 3, y: 3 }, 241);
  await expectResultBandOneReadout({ x: 1, y: 0 }, 110);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: PERCENTILE_CLIP,
    detailSubstrings: ["Percentile clip (2 - 30%, full stack)"],
  });
});

test("band-wise clips the entered band with its own cut points", async () => {
  await openOperation(launched.window, PERCENTILE_CLIP);
  await selectBandWiseScopeForBands(launched.window, PERCENTILE_CLIP, "1");
  await applyOperation(launched.window, PERCENTILE_CLIP);

  await expectResultIsFullSizeFloat32Stack();
  await expectResultBandOneReadout({ x: 0, y: 0 }, 103);
  await expectResultBandOneReadout({ x: 3, y: 3 }, 247);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: PERCENTILE_CLIP,
    detailSubstrings: ["Percentile clip (2 - 98%, band-wise: bands 1)"],
  });
});

async function expectResultIsFullSizeFloat32Stack(): Promise<void> {
  expect(await countPanels(launched.window)).toBe(RESULT_PANEL);
  await selectPanel(launched.window, RESULT_PANEL);
  await expectMetadataDataTypeAndDimensions(launched.window, {
    dataType: FLOAT32,
    width: FIXTURE.width,
    height: FIXTURE.height,
  });
  const metadata = await readMetadata(launched.window);
  expect(metadata.bandCount).toBe(String(FIXTURE.bandCount));
}

async function expectResultBandOneReadout(
  pixel: { x: number; y: number },
  expected: number,
): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: RESULT_PANEL,
    imageX: pixel.x,
    imageY: pixel.y,
    dimensions: DIMENSIONS,
    expected,
    tolerance: FLOAT_READOUT_TOLERANCE,
  });
}
