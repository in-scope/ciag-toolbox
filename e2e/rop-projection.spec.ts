import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  builtinScriptReferences,
  fixturePath,
  maskMultibandPng,
  multiBandTiff,
} from "./fixtures/fixture-manifest";
import { nonClearPixelFraction, summarizeCanvasPixels } from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  chooseRopObjective,
  closeMasksOptions,
  expectHistoryToRecordOperation,
  expectPixelReadoutToEqual,
  importMaskFromPath,
  loadFixtureAsStack,
  openMasksOptions,
  openOperation,
  panelCanvas,
  pressNewProjectionUntilScoreShows,
  pressNewProjectionUntilSeedShows,
  readPixelValueAt,
  ropCnrBackgroundCategoryPicker,
  ropCnrTextCategoryPicker,
  ropKeepButton,
  ropNewProjectionButton,
  ropObjectivePicker,
  ropOptionsPanel,
  ropScoreReadout,
  ropSeedReadout,
  ROP_NO_CANDIDATE_TEXT,
  ROP_PANEL_LABEL,
  selectPanel,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-309: press-to-reroll random orthogonal projections. The stack is
// multiband-12bit.tif (4x4x3 uint16, renders near-black by default) and the
// labels come from importing mask-multiband.png (top row Parchment, bottom row
// Substrate). The app is launched with MSI_E2E_ROP_FORCED_SEED so every press
// draws the reference seed.
//
// ORACLES, one per claim the story makes:
//   - the press really changed what is ON SCREEN: nonClearPixelFraction of the
//     panel canvas, near zero for the dark stack until the float candidate's
//     auto-fit preview brightens it (the normalized-viewing.spec.ts pattern);
//   - the preview is DISPLAY-ONLY: the status-bar readout at (0,0) still
//     reports the stack's true value 100 while the preview shows;
//   - Keep commits the REFERENCE projection: manifest.json's
//     builtinScriptReferences.rop, pinned by the CT-307 reference runner
//     executing the SAME packaged rop.py outside the app, asserted through the
//     kept panel's pixel readout within 1e-4 relative tolerance (plus the
//     readout's own four-significant-figure display quantum);
//   - the CNR score matches builtinScriptReferences.ropCnr, computed by the
//     generator with the exact locked formula over the reference candidate.

const SOURCE_PANEL = 1;
const KEPT_PANEL = 2;
const IMAGE = { width: multiBandTiff.width, height: multiBandTiff.height };
const FORCED_SEED = Number(builtinScriptReferences.rop.params.seed);
const REFERENCE_VALUES = builtinScriptReferences.rop.values;
const REFERENCE_CNR_SCORE = builtinScriptReferences.ropCnr.value;
const EXPECTED_SCORE_TEXT = REFERENCE_CNR_SCORE.toPrecision(4);
const SOURCE_ORIGIN_VALUE = String(multiBandTiff.samplePixels[0]?.valuesPerBand[0]);
const NEAR_BLACK_FRACTION_CEILING = 0.02;
const BRIGHTENED_FRACTION_FLOOR = 0.05;
const RELATIVE_TOLERANCE = 1e-4;

// The readout formats float values to four significant figures, so the parity
// assertion allows the reference tolerance plus half the display quantum.
function keptReadoutToleranceFor(referenceValue: number): number {
  const magnitude = Math.floor(Math.log10(Math.abs(referenceValue)));
  const displayQuantum = 10 ** (magnitude - 3);
  return Math.abs(referenceValue) * RELATIVE_TOLERANCE + displayQuantum / 2;
}

function referenceValueAtPixel(x: number, y: number): number {
  const value = REFERENCE_VALUES[y * IMAGE.width + x];
  if (value === undefined) throw new Error(`rop reference is missing pixel (${x}, ${y})`);
  return value;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp({
    extraEnvironment: { MSI_E2E_ROP_FORCED_SEED: String(FORCED_SEED) },
  });
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, SOURCE_PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("previews a projection display-only, scores it with CNR, and keeps the reference stack", async () => {
  const page = launched.window;

  await importTheParchmentMask(page);
  await expectSourcePanelRendersNearBlack(page);
  await assertSourceOriginStillReadsItsTrueValue(page);

  await openOperation(page, ROP_PANEL_LABEL);
  await expect(ropSeedReadout(page)).toHaveText(ROP_NO_CANDIDATE_TEXT);
  await pressNewProjectionUntilSeedShows(page, FORCED_SEED);

  await expectSourcePanelBrightenedByThePreview(page);
  await assertSourceOriginStillReadsItsTrueValue(page);

  await chooseRopObjective(page, "CNR");
  await expectCnrCategoriesDefaultToParchmentOverSubstrate(page);
  await pressNewProjectionUntilScoreShows(page, EXPECTED_SCORE_TEXT);

  await keepTheCurrentCandidate(page);
  await expectKeptPanelMatchesTheReferenceProjection(page);
  await closeRopOptions(page);
  await expectKeptPanelHistoryNamesSeedAndScore(page);
});

test("locks the mask objectives until a layer with two painted categories exists", async () => {
  const page = launched.window;

  await openOperation(page, ROP_PANEL_LABEL);
  await expectMaskObjectivesLockedWithAnExplanation(page);

  await closeRopOptions(page);
  await importTheParchmentMask(page);
  await openOperation(page, ROP_PANEL_LABEL);

  await expect(ropObjectivePicker(page).locator('option[value="npc"]')).toHaveJSProperty(
    "disabled",
    false,
  );
  await expect(ropObjectivePicker(page).locator('option[value="cnr"]')).toHaveJSProperty(
    "disabled",
    false,
  );
  await expect(ropOptionsPanel(page)).not.toContainText("painted pixels");
});

async function importTheParchmentMask(page: Page): Promise<void> {
  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await closeMasksOptions(page);
}

async function closeRopOptions(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Close the ROP options aside", async () => {
    await ropOptionsPanel(page).getByRole("button", { name: "Close ROP options" }).click();
    await expect(ropOptionsPanel(page)).toBeHidden();
  });
}

async function expectSourcePanelRendersNearBlack(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Baseline: the source panel renders near-black", async () => {
    const canvas = panelCanvas(page, SOURCE_PANEL);
    await expect
      .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(canvas)))
      .toBeLessThan(NEAR_BLACK_FRACTION_CEILING);
  });
}

async function expectSourcePanelBrightenedByThePreview(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The candidate preview brightened the panel", async () => {
    const canvas = panelCanvas(page, SOURCE_PANEL);
    await expect
      .poll(async () => nonClearPixelFraction(await summarizeCanvasPixels(canvas)))
      .toBeGreaterThan(BRIGHTENED_FRACTION_FLOOR);
  });
}

async function assertSourceOriginStillReadsItsTrueValue(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The data readout still reports the true value", async () => {
    const readout = await readPixelValueAt(page, SOURCE_PANEL, 0, 0, IMAGE);
    expect(readout.value).toBe(SOURCE_ORIGIN_VALUE);
  });
}

async function expectCnrCategoriesDefaultToParchmentOverSubstrate(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "CNR defaults to categories 1 and 2", async () => {
    await expect(ropCnrTextCategoryPicker(page)).toHaveValue("1");
    await expect(ropCnrBackgroundCategoryPicker(page)).toHaveValue("2");
  });
}

async function keepTheCurrentCandidate(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Keep the current candidate as a new stack", async () => {
    await ropKeepButton(page).click();
    await expect(page.getByText("Projection kept")).toBeVisible();
    await expect(panelCanvas(page, KEPT_PANEL)).toBeVisible();
  });
}

async function expectKeptPanelMatchesTheReferenceProjection(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The kept stack matches the pinned reference", async () => {
    for (const pixel of [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 3 },
      { x: 3, y: 3 },
    ]) {
      const expected = referenceValueAtPixel(pixel.x, pixel.y);
      await expectPixelReadoutToEqual(page, {
        panel: KEPT_PANEL,
        imageX: pixel.x,
        imageY: pixel.y,
        dimensions: IMAGE,
        expected,
        tolerance: keptReadoutToleranceFor(expected),
      });
    }
  });
}

async function expectKeptPanelHistoryNamesSeedAndScore(page: Page): Promise<void> {
  await selectPanel(page, KEPT_PANEL);
  await expectHistoryToRecordOperation(page, {
    actionLabel: ROP_PANEL_LABEL,
    detailSubstrings: [`ROP (seed ${FORCED_SEED}, CNR: ${EXPECTED_SCORE_TEXT})`],
  });
}

async function expectMaskObjectivesLockedWithAnExplanation(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Mask objectives are locked with no mask layers", async () => {
    await expect(ropObjectivePicker(page)).toHaveValue("none");
    await expect(ropObjectivePicker(page).locator('option[value="npc"]')).toHaveJSProperty(
      "disabled",
      true,
    );
    await expect(ropObjectivePicker(page).locator('option[value="cnr"]')).toHaveJSProperty(
      "disabled",
      true,
    );
    await expect(ropOptionsPanel(page)).toContainText(
      "NPC and CNR need a mask layer with at least two categories that have painted pixels.",
    );
    await expect(ropNewProjectionButton(page)).toBeEnabled();
    await expect(ropScoreReadout(page)).toHaveCount(0);
  });
}
