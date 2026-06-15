import { test, expect } from "@playwright/test";

import { flatFieldReferenceTiff, fixturePath, multiBandTiff } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  FLAT_FIELD_DARK_FIELD_LABEL,
  FLAT_FIELD_LABEL,
  FLAT_FIELD_LIGHT_FIELD_LABEL,
  applyOperationInPlace,
  chooseFlatFieldReferenceFileThroughDialog,
  chooseLoadedPanelAsFlatFieldReference,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  expectPixelReadoutToEqual,
  flatFieldErrorToast,
  loadFixtureAsStack,
  openOperation,
  selectActiveBandNumber,
  writeTemporarySingleBandUint16Tiff,
} from "./support/page-objects";

// CT-137 / manual section 4 / CT-078, CT-111: flat-field correction is C = m * (R - D) / (F - D).
// Feeding the stack in as its own light reference collapses to C = m, so every pixel of band i
// becomes that band's pre-operation mean - a numeric end-to-end check needing no real captures.
// The reference may be a loaded panel OR a file on disk (History names whichever), a single-band
// reference is broadcast across all bands, and every rejection path (wrong band count, wrong size,
// zero divisor) aborts with a clear message and leaves the stack unchanged (no NaN-filled image).

const PANEL = 1;
const FLOAT32 = "float32";
const READOUT_TOLERANCE = 0.01;
const FOUR_BY_FOUR: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const MULTIBAND_PANEL_OPTION = `Panel ${PANEL} (${multiBandTiff.fileName})`;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("self-reference (stack as its own light) turns every band into that band's mean", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await openOperation(launched.window, FLAT_FIELD_LABEL);
  await chooseLoadedPanelAsFlatFieldReference(launched.window, FLAT_FIELD_LIGHT_FIELD_LABEL, MULTIBAND_PANEL_OPTION);
  await applyOperationInPlace(launched.window, FLAT_FIELD_LABEL);

  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: FLOAT32, width: 4, height: 4 });
  await expectEveryBandFlattenedToItsMean();
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: FLAT_FIELD_LABEL,
    detailSubstrings: [`Panel ${PANEL}`],
  });
});

test("a single-band file reference is broadcast across every band and History names the file", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await openOperation(launched.window, FLAT_FIELD_LABEL);
  await chooseFlatFieldReferenceFileFor(FLAT_FIELD_LIGHT_FIELD_LABEL, flatFieldReferenceTiff.fileName);
  await applyOperationInPlace(launched.window, FLAT_FIELD_LABEL);

  await expectMetadataDataTypeAndDimensions(launched.window, { dataType: FLOAT32, width: 4, height: 4 });
  await expectActiveBandCornerEquals(1, multibandCornerValue(0));
  await expectActiveBandCornerEquals(2, multibandCornerValue(1));
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: FLAT_FIELD_LABEL,
    detailSubstrings: [flatFieldReferenceTiff.fileName],
  });
});

test("a reference whose band count is neither equal nor one is rejected with a clear message", async () => {
  await loadFixtureAsStack(launched.window, flatFieldReferenceTiff.fileName);
  await openOperation(launched.window, FLAT_FIELD_LABEL);
  await chooseFlatFieldReferenceFileFor(FLAT_FIELD_LIGHT_FIELD_LABEL, multiBandTiff.fileName);
  await applyOperationInPlace(launched.window, FLAT_FIELD_LABEL);

  const toast = flatFieldErrorToast(launched.window);
  await expect(toast).toContainText("does not match");
  await expect(toast).toContainText(`${multiBandTiff.bandCount} bands`);
  await expectStackUnchanged(flatFieldReferenceTiff.dataType, multibandReferenceCornerValue());
});

test("a wrong-size reference is rejected naming both sizes", async () => {
  const smallReferencePath = await writeTemporarySingleBandUint16Tiff({ width: 2, height: 2, fillValue: 1000 });
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await openOperation(launched.window, FLAT_FIELD_LABEL);
  await chooseFlatFieldReferenceFileThroughDialog(launched.window, FLAT_FIELD_LIGHT_FIELD_LABEL, smallReferencePath);
  await applyOperationInPlace(launched.window, FLAT_FIELD_LABEL);

  const toast = flatFieldErrorToast(launched.window);
  await expect(toast).toContainText("2x2");
  await expect(toast).toContainText("4x4");
  await expectStackUnchanged(multiBandTiff.dataType, multibandCornerValue(0));
});

test("a zero-divisor (light equals dark) aborts naming the failing band with no NaN", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await openOperation(launched.window, FLAT_FIELD_LABEL);
  await chooseLoadedPanelAsFlatFieldReference(launched.window, FLAT_FIELD_LIGHT_FIELD_LABEL, MULTIBAND_PANEL_OPTION);
  await chooseLoadedPanelAsFlatFieldReference(launched.window, FLAT_FIELD_DARK_FIELD_LABEL, MULTIBAND_PANEL_OPTION);
  await applyOperationInPlace(launched.window, FLAT_FIELD_LABEL);

  const toast = flatFieldErrorToast(launched.window);
  await expect(toast).toContainText("aborted");
  await expect(toast).toContainText("Band 1");
  await expectStackUnchanged(multiBandTiff.dataType, multibandCornerValue(0));
});

async function expectEveryBandFlattenedToItsMean(): Promise<void> {
  await expectActiveBandCornerEquals(1, multibandBandMean(0));
  await expectReadoutEquals(3, 3, multibandBandMean(0));
  await expectActiveBandCornerEquals(2, multibandBandMean(1));
  await expectActiveBandCornerEquals(3, multibandBandMean(2));
}

async function expectActiveBandCornerEquals(bandNumber: number, expected: number): Promise<void> {
  await selectActiveBandNumber(launched.window, bandNumber);
  await expectReadoutEquals(0, 0, expected);
}

async function expectStackUnchanged(dataType: string, cornerValue: number): Promise<void> {
  await expectMetadataDataTypeAndDimensions(launched.window, { dataType, width: 4, height: 4 });
  await expectReadoutEquals(0, 0, cornerValue);
}

async function expectReadoutEquals(imageX: number, imageY: number, expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX,
    imageY,
    dimensions: FOUR_BY_FOUR,
    expected,
    tolerance: READOUT_TOLERANCE,
  });
}

async function chooseFlatFieldReferenceFileFor(fieldLabel: string, fixtureFileName: string): Promise<void> {
  await chooseFlatFieldReferenceFileThroughDialog(launched.window, fieldLabel, fixturePath(fixtureFileName));
}

function multibandCornerValue(bandIndex: number): number {
  const value = multiBandTiff.samplePixels[0]?.valuesPerBand[bandIndex];
  if (value === undefined) throw new Error(`multiBandTiff (0,0) has no band ${bandIndex} value`);
  return value;
}

function multibandBandMean(bandIndex: number): number {
  const mean = multiBandTiff.bandMeans?.[bandIndex];
  if (mean === undefined) throw new Error(`multiBandTiff has no band-${bandIndex} mean`);
  return mean;
}

function multibandReferenceCornerValue(): number {
  const value = flatFieldReferenceTiff.samplePixels[0]?.valuesPerBand[0];
  if (value === undefined) throw new Error("flatFieldReferenceTiff (0,0) has no value");
  return value;
}
