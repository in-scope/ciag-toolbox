import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  builtinScriptReferences,
  fixturePath,
  maskMultibandPng,
  multiBandTiff,
} from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  chooseCnrBackgroundCategory,
  chooseCnrTextCategory,
  closeMasksOptions,
  cnrBackgroundCategoryPicker,
  cnrComputeButton,
  cnrMaskLayerPicker,
  cnrOptionsPanel,
  cnrScorePlot,
  cnrScoresSection,
  cnrTextCategoryPicker,
  computeCnrScores,
  expectScoreWithinRelativeTolerance,
  importMaskFromPath,
  loadFixtureAsStack,
  openMasksOptions,
  openOperation,
  readHistoryEntries,
  selectPanel,
  CNR_NOT_COMPUTED_TEXT,
  CNR_PANEL_LABEL,
  type CnrTopBandRowReadout,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-320: CNR as its own Multi-band tool. The stack is multiband-12bit.tif
// (4x4x3 uint16) and the labels come from importing mask-multiband.png, whose
// category 1 ("Parchment") is the top row and category 2 ("Substrate") is the
// bottom row.
//
// ORACLE: manifest.json's builtinScriptReferences.cnrPerBand, computed by the
// fixture generator in JS with the locked formula - one score per band, in band
// order. Swapping the two categories must negate every score, which is the
// check no "print the same list back" stub survives.

const PANEL = 1;
const MASK_LAYER_NAME = maskMultibandPng.name ?? "Parchment mask";
const TEXT_CATEGORY_NAME = "Parchment";
const BACKGROUND_CATEGORY_NAME = "Substrate";
const BAND_SCORES = builtinScriptReferences.cnrPerBand.value;
const MAX_TOP_BAND_ROWS = 5;

const CNR_EXPLANATION =
  "Contrast-to-noise ratio, band by band: the mean of the text category minus " +
  "the mean of the background category, divided by the background's standard " +
  "deviation. Higher is better.";

// The panel shows a score to four significant figures, trailing zeros kept.
function formatScoreAsThePanelDoes(score: number): string {
  return score.toPrecision(4);
}

interface ExpectedTopBandRow {
  readonly bandIdentityText: string;
  readonly score: number;
}

function describeExpectedTopBandRows(
  scores: ReadonlyArray<number>,
): ReadonlyArray<ExpectedTopBandRow> {
  return scores
    .map((score, bandIndex) => ({ bandIdentityText: `Band ${bandIndex + 1}`, score, bandIndex }))
    .sort((left, right) => right.score - left.score || left.bandIndex - right.bandIndex)
    .slice(0, MAX_TOP_BAND_ROWS);
}

function describeExpectedHistoryDetail(
  textCategoryName: string,
  backgroundCategoryName: string,
  scores: ReadonlyArray<number>,
): string {
  const rows = describeExpectedTopBandRows(scores)
    .map((row) => `${row.bandIdentityText} ${formatScoreAsThePanelDoes(row.score)}`)
    .join(", ");
  const categories = `${textCategoryName} vs ${backgroundCategoryName}`;
  return `CNR (${MASK_LAYER_NAME}, ${categories}): ${rows}`;
}

function expectTopBandRowsMatchReference(
  rows: ReadonlyArray<CnrTopBandRowReadout>,
  scores: ReadonlyArray<number>,
): void {
  const expected = describeExpectedTopBandRows(scores);
  expect(rows.map((row) => row.bandIdentityText)).toEqual(
    expected.map((row) => row.bandIdentityText),
  );
  // The panel rounds to four significant figures, so the pinned reference is
  // compared in the panel's own formatting rather than as a raw double.
  expect(rows.map((row) => row.scoreText)).toEqual(
    expected.map((row) => formatScoreAsThePanelDoes(row.score)),
  );
}

function expectRowsAreSortedBestFirst(rows: ReadonlyArray<CnrTopBandRowReadout>): void {
  const scores = rows.map((row) => Number(row.scoreText));
  expect(scores).toEqual([...scores].sort((left, right) => right - left));
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("scores every band against the chosen categories and records each run in History", async () => {
  const page = launched.window;

  await importTheParchmentMask(page);
  await openOperation(page, CNR_PANEL_LABEL);
  await expectPanelDefaultsToTheImportedLayerAndCategories(page);

  const rows = await computeCnrScores(page);
  expectTopBandRowsMatchReference(rows, BAND_SCORES);
  expectRowsAreSortedBestFirst(rows);
  await expectThePlotIsOnScreen(page);

  await expectMatchingCategoriesLockCompute(page);
  const swappedRows = await swapTheCategoriesAndCompute(page);
  expectTopBandRowsMatchReference(swappedRows, BAND_SCORES.map(negate));
  expectTheTopRowIsTheNegatedFirstRun(swappedRows, rows);

  await closeCnrOptions(page);
  await expectHistoryRecordsBothRuns(page);
});

test("keeps the controls locked until a mask layer has two painted categories", async () => {
  const page = launched.window;

  await openOperation(page, CNR_PANEL_LABEL);
  await expectPanelBlockedWithTheCnrExplanation(page);

  await closeCnrOptions(page);
  await importTheParchmentMask(page);
  await openOperation(page, CNR_PANEL_LABEL);

  await expect(cnrComputeButton(page)).toBeEnabled();
  await expect(cnrScoresSection(page)).toHaveText(CNR_NOT_COMPUTED_TEXT);
});

function negate(score: number): number {
  return -score;
}

async function importTheParchmentMask(page: Page): Promise<void> {
  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await closeMasksOptions(page);
}

async function closeCnrOptions(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Close the CNR options aside", async () => {
    await cnrOptionsPanel(page).getByRole("button", { name: "Close CNR options" }).click();
    await expect(cnrOptionsPanel(page)).toBeHidden();
  });
}

async function expectPanelDefaultsToTheImportedLayerAndCategories(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Read the CNR panel's defaults", async () => {
    await expect(cnrMaskLayerPicker(page).locator("option")).toHaveText([MASK_LAYER_NAME]);
    await expect(cnrTextCategoryPicker(page)).toHaveValue("1");
    await expect(cnrBackgroundCategoryPicker(page)).toHaveValue("2");
    await expect(cnrScoresSection(page)).toHaveText(CNR_NOT_COMPUTED_TEXT);
    // A score is not a raster, so the panel offers no result destination.
    await expect(cnrOptionsPanel(page).getByRole("button", { name: "Apply" })).toHaveCount(0);
  });
}

async function expectPanelBlockedWithTheCnrExplanation(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Read the CNR panel with no mask layers", async () => {
    await expect(cnrOptionsPanel(page)).toContainText(CNR_EXPLANATION);
    await expect(cnrOptionsPanel(page)).toContainText("no mask layers");
    await expect(cnrComputeButton(page)).toBeDisabled();
    await expect(cnrMaskLayerPicker(page)).toBeDisabled();
    await expect(cnrTextCategoryPicker(page)).toBeDisabled();
    await expect(cnrBackgroundCategoryPicker(page)).toBeDisabled();
  });
}

async function expectThePlotIsOnScreen(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "See the per-band score plot", async () => {
    await expect(cnrScorePlot(page)).toBeVisible();
    await expect(cnrScorePlot(page).getByRole("img", { name: "CNR per band plot" })).toBeVisible();
  });
}

// Contrasting a category with itself is zero over zero, so Compute waits until
// the two pickers disagree again.
async function expectMatchingCategoriesLockCompute(page: Page): Promise<void> {
  await chooseCnrBackgroundCategory(page, TEXT_CATEGORY_NAME);
  await runAsStoryboardStep(page, "See Compute locked by the matching categories", async () => {
    await expect(cnrComputeButton(page)).toBeDisabled();
    await expect(cnrScoresSection(page)).toHaveText(CNR_NOT_COMPUTED_TEXT);
  });
}

async function swapTheCategoriesAndCompute(page: Page): Promise<CnrTopBandRowReadout[]> {
  await chooseCnrTextCategory(page, BACKGROUND_CATEGORY_NAME);
  await chooseCnrBackgroundCategory(page, TEXT_CATEGORY_NAME);
  await expect(cnrComputeButton(page)).toBeEnabled();
  return computeCnrScores(page);
}

function expectTheTopRowIsTheNegatedFirstRun(
  swappedRows: ReadonlyArray<CnrTopBandRowReadout>,
  rows: ReadonlyArray<CnrTopBandRowReadout>,
): void {
  const first = Number(rows[0]?.scoreText);
  const swapped = Number(swappedRows[0]?.scoreText);
  expectScoreWithinRelativeTolerance(swapped, -first);
}

async function expectHistoryRecordsBothRuns(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Read the two CNR entries in History", async () => {
    const entries = await readHistoryEntries(page);
    const cnrEntries = entries.filter((entry) => entry.actionLabel === CNR_PANEL_LABEL);
    expect(cnrEntries.map((entry) => entry.detailLines.join(" "))).toEqual([
      describeExpectedHistoryDetail(TEXT_CATEGORY_NAME, BACKGROUND_CATEGORY_NAME, BAND_SCORES),
      describeExpectedHistoryDetail(
        BACKGROUND_CATEGORY_NAME,
        TEXT_CATEGORY_NAME,
        BAND_SCORES.map(negate),
      ),
    ]);
  });
}
