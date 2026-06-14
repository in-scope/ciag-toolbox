import { test, expect } from "@playwright/test";
import { join } from "node:path";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  createTemporaryProjectBundleDirectory,
  loadFixtureAsStack,
  openOperation,
  openProjectBundleThroughOpenDialog,
  readHistoryEntries,
  readMetadata,
  readPixelValueAt,
  saveProjectBundleThroughSaveDialog,
  type HistoryEntryReadout,
  type MetadataReadout,
  type PixelDimensions,
} from "./support/page-objects";
import type { ElectronApplication, Page } from "@playwright/test";

// CT-129: Project save and resume (CT-033/CT-034). After a short chain of operations, saving a
// project bundle (.ctbundle) through the save-dialog stub and reopening it through the open-dialog
// stub must restore IDENTICAL pixels (spot-checked readouts), IDENTICAL History, and IDENTICAL
// band metadata. The chain is two in-place Bit Shifts on the 12-bit-in-uint16 fixture so the
// raster is operation-produced (forcing a re-bake into the bundle), History carries two entries,
// and the values stay integer for exact comparison. "Before" values are captured live and compared
// after the reopen, so a fixture change does not require editing hardcoded numbers.

const MULTIBAND_DIMENSIONS: PixelDimensions = {
  width: multiBandTiff.width,
  height: multiBandTiff.height,
};

const BIT_SHIFT_OPERATION_LABEL = "Bit Shift";

interface ProjectRoundTripSnapshot {
  readonly metadata: MetadataReadout;
  readonly topLeftBandZero: string;
  readonly bottomRightBandZero: string;
  readonly history: ReadonlyArray<HistoryEntryReadout>;
}

test("saves a project after a chain of operations and reopens it with identical state", async () => {
  await withFreshApp(async ({ app, window }) => {
    await loadFixtureAsStack(window, multiBandTiff.fileName);
    await applyTwoInPlaceBitShifts(window);
    const before = await readProjectRoundTripSnapshot(window);
    expect(before.history).toHaveLength(2);
    await saveThenReopenProjectBundle(app, window);
    const after = await readProjectRoundTripSnapshot(window);
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

async function applyTwoInPlaceBitShifts(window: Page): Promise<void> {
  await applyOneInPlaceBitShift(window);
  await applyOneInPlaceBitShift(window);
}

async function applyOneInPlaceBitShift(window: Page): Promise<void> {
  await openOperation(window, BIT_SHIFT_OPERATION_LABEL);
  await applyOperationInPlace(window, BIT_SHIFT_OPERATION_LABEL);
}

async function readProjectRoundTripSnapshot(window: Page): Promise<ProjectRoundTripSnapshot> {
  const topLeft = await readPixelValueAt(window, 1, 0, 0, MULTIBAND_DIMENSIONS);
  const bottomRight = await readPixelValueAt(window, 1, 3, 3, MULTIBAND_DIMENSIONS);
  return {
    metadata: await readMetadata(window),
    topLeftBandZero: topLeft.value,
    bottomRightBandZero: bottomRight.value,
    history: await readHistoryEntries(window),
  };
}

async function saveThenReopenProjectBundle(
  app: ElectronApplication,
  window: Page,
): Promise<void> {
  const bundlePath = join(await createTemporaryProjectBundleDirectory(), "roundtrip.ctbundle");
  await saveProjectBundleThroughSaveDialog({ app, page: window, destinationPath: bundlePath });
  await openProjectBundleThroughOpenDialog({ app, page: window, bundlePath });
}

function expectSnapshotsMatch(
  before: ProjectRoundTripSnapshot,
  after: ProjectRoundTripSnapshot,
): void {
  expect(after.metadata.dataType).toBe(before.metadata.dataType);
  expect(after.metadata.width).toBe(before.metadata.width);
  expect(after.metadata.height).toBe(before.metadata.height);
  expect(after.metadata.bandCount).toBe(before.metadata.bandCount);
  expect(after.topLeftBandZero).toBe(before.topLeftBandZero);
  expect(after.bottomRightBandZero).toBe(before.bottomRightBandZero);
  expect(after.history).toEqual(before.history);
}
