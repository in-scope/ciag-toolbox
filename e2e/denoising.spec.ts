import { expect, test } from "@playwright/test";

import { noisyGrayPng } from "./fixtures/fixture-manifest";
import type { NoisyGraySpike } from "./fixtures/fixture-manifest";
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
  readPixelValueAt,
  selectPanel,
  setOperationEnumParameter,
  type PixelDimensions,
} from "./support/page-objects";

// CT-204: the Denoise operation (Gaussian / median) outputs a NEW float32
// stack in a fresh panel. noisy-gray.png is a smooth 8x8 ramp with two pinned
// salt-and-pepper spikes; the manifest records each spike's noisy (pre) value,
// smooth base value, and the exact radius-1 median-denoised (post) value. The
// pixel-readout oracle asserts the median restores those exact post values and
// that the Gaussian pulls each spike more than halfway back toward the smooth
// base (the spike is attenuated, so the neighborhood is smoother).

const DENOISE = "Denoise";
const RESULT_PANEL = 2;
const FIXTURE = noisyGrayPng;
const DIMENSIONS: PixelDimensions = { width: FIXTURE.width, height: FIXTURE.height };
const FLOAT32 = "float32";
const FLOAT_READOUT_TOLERANCE = 0.001;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, FIXTURE.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("median removes the pinned salt-and-pepper spikes exactly", async () => {
  await openOperation(launched.window, DENOISE);
  await setOperationEnumParameter(launched.window, DENOISE, "median");
  await applyOperation(launched.window, DENOISE);

  await expectResultIsFullSizeFloat32Stack();
  for (const spike of FIXTURE.spikes) {
    await expectPixelReadoutToEqual(launched.window, {
      panel: RESULT_PANEL,
      imageX: spike.x,
      imageY: spike.y,
      dimensions: DIMENSIONS,
      expected: spike.medianDenoisedValue,
      tolerance: FLOAT_READOUT_TOLERANCE,
    });
  }
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: DENOISE,
    detailSubstrings: ["Denoise (median, radius 1, full stack)"],
  });
});

test("Gaussian (the default) attenuates each pinned spike toward the smooth base", async () => {
  await openOperation(launched.window, DENOISE);
  await applyOperation(launched.window, DENOISE);

  await expectResultIsFullSizeFloat32Stack();
  for (const spike of FIXTURE.spikes) {
    await expectSpikeAttenuatedTowardSmoothBase(spike);
  }
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: DENOISE,
    detailSubstrings: ["Denoise (Gaussian, sigma 1, full stack)"],
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
}

// A sigma-1 Gaussian keeps ~16% of the spike's deviation at its own pixel, so
// the denoised value must land well inside the halfway mark between the noisy
// spike and the smooth base underneath it.
async function expectSpikeAttenuatedTowardSmoothBase(spike: NoisyGraySpike): Promise<void> {
  const readout = await readPixelValueAt(
    launched.window,
    RESULT_PANEL,
    spike.x,
    spike.y,
    DIMENSIONS,
  );
  const denoisedValue = Number.parseFloat(readout.value);
  const spikeDeviation = Math.abs(spike.noisyValue - spike.smoothValue);
  expect(Number.isFinite(denoisedValue)).toBe(true);
  expect(Math.abs(denoisedValue - spike.smoothValue)).toBeLessThan(spikeDeviation / 2);
}
