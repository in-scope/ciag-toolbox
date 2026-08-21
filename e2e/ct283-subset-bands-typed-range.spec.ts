import { expect, test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applySubsetBands,
  loadFixtureAsStack,
  openSubsetBandsEditor,
  readMetadata,
  readPixelValueAt,
  selectActiveBandNumber,
  selectPanel,
  setSubsetBandsOpenInNewPanel,
  subsetBandsKeepCheckboxes,
  subsetBandsTypedRangeField,
  typeSubsetBandsRange,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-283: the Subset Bands editor accepts a typed index list ("1, 20-30") above the
// checkbox list. A valid expression checks exactly those bands (overriding the
// checkbox state); manual checkbox edits do not rewrite the field; invalid text shows
// the parse-band-range error and changes no selection.
//
// Fixture: multiband-12bit.tif (4x4, 3 bands uint16, pixel (0,0) = [100, 800, 1600]).
// Oracle: checkbox aria-checked states, the Metadata band count, and the pixel-readout
// status bar per kept band.

const PANEL = 1;
const DIMENSIONS = { width: multiBandTiff.width, height: multiBandTiff.height };
const FIELD_HINT = "Use commas to list bands and dashes for ranges (e.g. 1,3,5 or 1-5,10)";
const OUT_OF_RANGE_ERROR = "Band 99 is out of range (1-3).";
const SAMPLE_PIXEL = multiBandTiff.samplePixels[0]!;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a typed range drives the checkboxes, rejects bad input, and applies exactly those bands", async () => {
  const page = launched.window;

  await runAsStoryboardStep(page, "The field renders above the list with its description", async () => {
    await openSubsetBandsEditor(page);
    await expect(subsetBandsTypedRangeField(page)).toBeVisible();
    await expect(page.getByText(FIELD_HINT, { exact: true })).toBeVisible();
  });

  await runAsStoryboardStep(page, "Typing a single band checks exactly that band", async () => {
    await typeSubsetBandsRange(page, "1");
    await expectKeptCheckboxStates(["true", "false", "false"]);
  });

  await runAsStoryboardStep(page, "A manual checkbox edit does not rewrite the field", async () => {
    await subsetBandsKeepCheckboxes(page).nth(1).click();
    await expectKeptCheckboxStates(["true", "true", "false"]);
    await expect(subsetBandsTypedRangeField(page)).toHaveValue("1");
  });

  await runAsStoryboardStep(page, "Re-typing a range overrides the checkbox state", async () => {
    await typeSubsetBandsRange(page, "2-3");
    await expectKeptCheckboxStates(["false", "true", "true"]);
  });

  await runAsStoryboardStep(page, "Out-of-range text shows the parse error and changes no selection", async () => {
    await typeSubsetBandsRange(page, "1,99");
    await expect(page.getByText(OUT_OF_RANGE_ERROR, { exact: true })).toBeVisible();
    await expectKeptCheckboxStates(["false", "true", "true"]);
  });

  await runAsStoryboardStep(page, "Valid text clears the error and restores the typed selection", async () => {
    await typeSubsetBandsRange(page, "2-3");
    await expect(page.getByText(OUT_OF_RANGE_ERROR, { exact: true })).toBeHidden();
    await expectKeptCheckboxStates(["false", "true", "true"]);
  });

  await runAsStoryboardStep(page, "Apply keeps exactly the typed bands", async () => {
    await setSubsetBandsOpenInNewPanel(page, false);
    await applySubsetBands(page);
    await expect.poll(async () => (await readMetadata(page)).bandCount).toBe("2");
  });

  await runAsStoryboardStep(page, "Each kept band reads its original exact value", async () => {
    await expectSamplePixelValueOnBand(1, String(SAMPLE_PIXEL.valuesPerBand[1]!));
    await expectSamplePixelValueOnBand(2, String(SAMPLE_PIXEL.valuesPerBand[2]!));
  });
});

async function expectKeptCheckboxStates(expected: ReadonlyArray<string>): Promise<void> {
  const checkboxes = subsetBandsKeepCheckboxes(launched.window);
  await expect(checkboxes).toHaveCount(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    await expect(checkboxes.nth(index)).toHaveAttribute("aria-checked", expected[index]!);
  }
}

async function expectSamplePixelValueOnBand(bandNumber: number, expectedValue: string): Promise<void> {
  await selectActiveBandNumber(launched.window, bandNumber);
  const readout = await readPixelValueAt(
    launched.window,
    PANEL,
    SAMPLE_PIXEL.x,
    SAMPLE_PIXEL.y,
    DIMENSIONS,
  );
  expect(readout.value).toBe(expectedValue);
}

// The "1,99" step intentionally follows a valid "2-3": the parse failure must leave the
// PREVIOUS selection intact (no partial application of the in-range "1").
