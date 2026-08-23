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
  closeMasksOptions,
  computeNpcScore,
  expectScoreWithinRelativeTolerance,
  importMaskFromPath,
  loadFixtureAsStack,
  npcBinsField,
  npcComputeButton,
  npcMaskLayerPicker,
  npcOptionsPanel,
  npcScoreReadout,
  NPC_NOT_COMPUTED_TEXT,
  NPC_PANEL_LABEL,
  openMasksOptions,
  openOperation,
  readHistoryEntries,
  selectPanel,
  setNpcBinCount,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-308: the NPC score. The stack is multiband-12bit.tif (4x4x3 uint16) and
// the labels come from importing mask-multiband.png, whose two categories are
// the top row and the bottom row.
//
// ORACLE: manifest.json's builtinScriptReferences, pinned by the CT-307
// reference runner executing the SAME packaged npc.py under the bundled Python
// runtime, outside the app. The 255-bin score is exactly 1 (those classes never
// share a value), so the spec also scores a COARSE 2-bin run, where the classes
// do share bins and the reference is 0.25 - a value no stub can guess.

const PANEL = 1;
const MASK_LAYER_NAME = maskMultibandPng.name ?? "Parchment mask";
const DEFAULT_BINS = builtinScriptReferences.npc.params.bins;
const COARSE_BINS = builtinScriptReferences.npcCoarseBins.params.bins;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("scores the imported mask at both binnings and records each run in History", async () => {
  const page = launched.window;

  await importTheParchmentMask(page);
  await openOperation(page, NPC_PANEL_LABEL);
  await expectPanelDefaultsToTheImportedLayer(page);

  const fineScore = await computeNpcScore(page);
  expectScoreWithinRelativeTolerance(fineScore, builtinScriptReferences.npc.value);

  await setNpcBinCount(page, Number(COARSE_BINS));
  const coarseScore = await computeNpcScore(page);
  expectScoreWithinRelativeTolerance(coarseScore, builtinScriptReferences.npcCoarseBins.value);

  await closeNpcOptions(page);
  await expectHistoryRecordsBothScores(page);
});

test("keeps the controls disabled until a mask layer has two painted categories", async () => {
  const page = launched.window;

  await openOperation(page, NPC_PANEL_LABEL);
  await expectPanelBlockedWithAnExplanation(page);

  await closeNpcOptions(page);
  await importTheParchmentMask(page);
  await openOperation(page, NPC_PANEL_LABEL);

  await expect(npcComputeButton(page)).toBeEnabled();
  await expect(npcScoreReadout(page)).toHaveText(NPC_NOT_COMPUTED_TEXT);
});

async function importTheParchmentMask(page: Page): Promise<void> {
  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await closeMasksOptions(page);
}

async function closeNpcOptions(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Close the NPC options aside", async () => {
    await npcOptionsPanel(page).getByRole("button", { name: "Close NPC options" }).click();
    await expect(npcOptionsPanel(page)).toBeHidden();
  });
}

async function expectPanelDefaultsToTheImportedLayer(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Read the NPC panel's defaults", async () => {
    await expect(npcMaskLayerPicker(page)).toHaveValue(/.+/);
    await expect(npcMaskLayerPicker(page).locator("option")).toHaveText([MASK_LAYER_NAME]);
    await expect(npcBinsField(page)).toHaveValue(String(DEFAULT_BINS));
    await expect(npcScoreReadout(page)).toHaveText(NPC_NOT_COMPUTED_TEXT);
    // A score is not a raster, so the panel offers no result destination.
    await expect(npcOptionsPanel(page).getByRole("button", { name: "Apply" })).toHaveCount(0);
  });
}

async function expectPanelBlockedWithAnExplanation(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Read the NPC panel with no mask layers", async () => {
    await expect(npcComputeButton(page)).toBeDisabled();
    await expect(npcMaskLayerPicker(page)).toBeDisabled();
    await expect(npcBinsField(page)).toBeDisabled();
    await expect(npcOptionsPanel(page)).toContainText("no mask layers");
  });
}

async function expectHistoryRecordsBothScores(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Read the two NPC entries in History", async () => {
    const entries = await readHistoryEntries(page);
    const npcEntries = entries.filter((entry) => entry.actionLabel === NPC_PANEL_LABEL);
    expect(npcEntries.map((entry) => entry.detailLines.join(" "))).toEqual([
      `NPC (${MASK_LAYER_NAME}, ${DEFAULT_BINS} bins): 1.000`,
      `NPC (${MASK_LAYER_NAME}, ${COARSE_BINS} bins): 0.2500`,
    ]);
  });
}
