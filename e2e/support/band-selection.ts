import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { openSubsetBandsEditor, subsetBandsEditor } from "./band-management";
import { clickApplyInPanelAndAwaitResult } from "./operations";
import { runAsStoryboardStep } from "./storyboard-step";

// CT-210 page objects for the band-selection function controls. CT-284 folded
// them into the Subset Bands editor's "By function" mode.
//
// CT-293: the functions are ONE exclusive segmented control (Average / Variance
// / Custom, `role="radio"` items like every other segmented control in the app).
// Custom is the only segment that reveals the formula field and "Import
// script...", and NOTHING runs until Apply - there is no "Run formula" button
// and no "Selected function" status line. The observable proof a custom
// function ran is the applied result itself (readout + History), not a staged
// status.

// History entries still carry the pre-merge vocabulary ("Band Selection").
export const BAND_SELECTION_OPERATION_LABEL = "Band Selection";
export const SUBSET_BANDS_BY_FUNCTION_MODE_VALUE = "by-function";

function bandSelectionFunctionPanel(page: Page): Locator {
  return subsetBandsEditor(page);
}

export function subsetBandsModeSelect(page: Page): Locator {
  return subsetBandsEditor(page).locator(
    `select:has(option[value="${SUBSET_BANDS_BY_FUNCTION_MODE_VALUE}"])`,
  );
}

export function bandSelectionFunctionSegment(page: Page, segmentLabel: string): Locator {
  return bandSelectionFunctionPanel(page).getByRole("radio", { name: segmentLabel, exact: true });
}

export function bandSelectionFormulaField(page: Page): Locator {
  return bandSelectionFunctionPanel(page).getByLabel("Band formula", { exact: true });
}

export function importBandSelectionScriptButton(page: Page): Locator {
  return bandSelectionFunctionPanel(page).getByRole("button", {
    name: "Import script...",
    exact: true,
  });
}

export async function openBandSelectionFunctionEditor(page: Page): Promise<Locator> {
  return runAsStoryboardStep(page, "Open Subset Bands in its By function mode", async () => {
    const editor = await openSubsetBandsEditor(page);
    await subsetBandsModeSelect(page).selectOption(SUBSET_BANDS_BY_FUNCTION_MODE_VALUE);
    await expectBandSelectionEditorReady(page);
    return editor;
  });
}

export async function applyBandSelectionFunction(page: Page): Promise<void> {
  await runAsStoryboardStep(
    page,
    "Apply the band-selection function and wait for the result panel to settle",
    async () => {
      await clickApplyInPanelAndAwaitResult(page, bandSelectionFunctionPanel(page));
    },
  );
}

export async function expectBandSelectionEditorReady(page: Page): Promise<void> {
  await expect(bandSelectionFunctionSegment(page, "Average")).toBeVisible();
}

export async function clickBandSelectionPreset(page: Page, presetLabel: string): Promise<void> {
  await bandSelectionFunctionSegment(page, presetLabel).click();
}

// Choosing Custom reveals the formula field; typing into it only CONFIGURES the
// run, so the caller still has to Apply.
export async function enterBandSelectionFormula(page: Page, expression: string): Promise<void> {
  await runAsStoryboardStep(page, "Configure a custom band formula", async () => {
    await bandSelectionFunctionSegment(page, "Custom").click();
    await bandSelectionFormulaField(page).fill(expression);
  });
}

export async function importBandSelectionScript(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Import a custom band tool", async () => {
    await bandSelectionFunctionSegment(page, "Custom").click();
    await importBandSelectionScriptButton(page).click();
  });
}

export async function expectBandSelectionToolLoaded(page: Page, fileName: string): Promise<void> {
  await expect(
    bandSelectionFunctionPanel(page).getByText(
      `Tool loaded: ${fileName}. Apply runs it on the stack.`,
      { exact: true },
    ),
  ).toBeVisible();
}
