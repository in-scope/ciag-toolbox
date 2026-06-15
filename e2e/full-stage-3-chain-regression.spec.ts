import { test, expect } from "@playwright/test";
import { join } from "node:path";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyGeometricTransformInPlace,
  applyOperationInPlace,
  createTemporaryProjectBundleDirectory,
  expectToneCurveOpensWithTwoEndpoints,
  loadFixtureAsStack,
  openOperation,
  openProjectBundleThroughOpenDialog,
  readHistoryEntries,
  readMetadata,
  readPixelValueAt,
  removeDisplayedBand,
  saveProjectBundleThroughSaveDialog,
  selectActiveBandNumber,
  selectFullStackScope,
  TONE_CURVE_LABEL,
  type HistoryEntryReadout,
  type MetadataReadout,
  type PixelDimensions,
} from "./support/page-objects";
import type { ElectronApplication, Page } from "@playwright/test";

// CT-158 / manual sign-off: a realistic Stage-3 chain must survive a project save/reload.
// On the multi-band uint16 fixture the chain is applied IN PLACE so each step builds on the
// previous raster: Normalize (full stack -> float32 [0,1]), Tone Curve (records a curve over
// the displayed band), Rotate 90 clockwise (relocates whole pixels), then remove the middle
// band (drops the band count and records the kept bands). That leaves a four-entry History on
// an operation-produced raster, which forces the bundle writer to re-bake pixels. Saving the
// .ctbundle through the save-dialog stub and reopening it through the open-dialog stub must
// restore IDENTICAL spot-checked pixel readouts, IDENTICAL History, and IDENTICAL band metadata.
// "Before" values are captured live and compared after the reopen, so a fixture change does not
// require editing hardcoded numbers.

const PANEL = 1;
const NORMALIZE = "Normalize";
const MIDDLE_BAND = 2;
const EXPECTED_CHAIN_HISTORY_LENGTH = 4;
const EXPECTED_BAND_COUNT_AFTER_REMOVAL = "2";
const DIMENSIONS: PixelDimensions = {
  width: multiBandTiff.width,
  height: multiBandTiff.height,
};

interface ChainSnapshot {
  readonly metadata: MetadataReadout;
  readonly bandOneTopLeft: string;
  readonly bandOneBottomRight: string;
  readonly bandTwoTopLeft: string;
  readonly history: ReadonlyArray<HistoryEntryReadout>;
}

test("runs a normalize, tone-curve, rotate, band-removal chain that survives a project save/reload", async () => {
  await withFreshApp(async ({ app, window }) => {
    await loadFixtureAsStack(window, multiBandTiff.fileName);
    await applyStageThreeChain(app, window);
    const before = await readChainSnapshot(window);
    expect(before.history).toHaveLength(EXPECTED_CHAIN_HISTORY_LENGTH);
    expect(before.metadata.bandCount).toBe(EXPECTED_BAND_COUNT_AFTER_REMOVAL);
    await saveThenReopenProjectBundle(app, window);
    const after = await readChainSnapshot(window);
    expectSnapshotsMatch(before, after);
  });
});

async function withFreshApp(run: (launched: LaunchedApp) => Promise<void>): Promise<void> {
  const launched = await launchToolboxApp();
  try {
    await run(launched);
  } finally {
    await closeToolboxApp(launched);
  }
}

async function applyStageThreeChain(app: ElectronApplication, window: Page): Promise<void> {
  await applyFullStackNormalize(window);
  await applyDefaultToneCurve(window);
  await applyGeometricTransformInPlace(app, window, "rotate-90-cw");
  await removeMiddleBand(window);
}

async function applyFullStackNormalize(window: Page): Promise<void> {
  await openOperation(window, NORMALIZE);
  await selectFullStackScope(window, NORMALIZE);
  await applyOperationInPlace(window, NORMALIZE);
}

async function applyDefaultToneCurve(window: Page): Promise<void> {
  await openOperation(window, TONE_CURVE_LABEL);
  await expectToneCurveOpensWithTwoEndpoints(window);
  await applyOperationInPlace(window, TONE_CURVE_LABEL);
}

async function removeMiddleBand(window: Page): Promise<void> {
  await selectActiveBandNumber(window, MIDDLE_BAND);
  await removeDisplayedBand(window, MIDDLE_BAND);
}

async function readChainSnapshot(window: Page): Promise<ChainSnapshot> {
  await selectActiveBandNumber(window, 1);
  const bandOneTopLeft = await readBandPixel(window, 0, 0);
  const bandOneBottomRight = await readBandPixel(window, 3, 3);
  await selectActiveBandNumber(window, 2);
  const bandTwoTopLeft = await readBandPixel(window, 0, 0);
  const metadata = await readMetadata(window);
  const history = await readHistoryEntries(window);
  return { metadata, bandOneTopLeft, bandOneBottomRight, bandTwoTopLeft, history };
}

async function readBandPixel(window: Page, x: number, y: number): Promise<string> {
  return (await readPixelValueAt(window, PANEL, x, y, DIMENSIONS)).value;
}

async function saveThenReopenProjectBundle(app: ElectronApplication, window: Page): Promise<void> {
  const bundlePath = join(await createTemporaryProjectBundleDirectory(), "chain-regression.ctbundle");
  await saveProjectBundleThroughSaveDialog({ app, page: window, destinationPath: bundlePath });
  await openProjectBundleThroughOpenDialog({ app, page: window, bundlePath });
}

function expectSnapshotsMatch(before: ChainSnapshot, after: ChainSnapshot): void {
  expect(after.metadata.dataType).toBe(before.metadata.dataType);
  expect(after.metadata.width).toBe(before.metadata.width);
  expect(after.metadata.height).toBe(before.metadata.height);
  expect(after.metadata.bandCount).toBe(before.metadata.bandCount);
  expect(after.bandOneTopLeft).toBe(before.bandOneTopLeft);
  expect(after.bandOneBottomRight).toBe(before.bandOneBottomRight);
  expect(after.bandTwoTopLeft).toBe(before.bandTwoTopLeft);
  expect(after.history).toEqual(before.history);
}
