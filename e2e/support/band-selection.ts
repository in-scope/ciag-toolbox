import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { openSubsetBandsEditor, subsetBandsEditor } from "./band-management";
import { clickApplyInPanelAndAwaitResult } from "./operations";
import { runAsStoryboardStep } from "./storyboard-step";

// CT-210 page objects for the band-selection function controls. CT-284 folded
// them into the Subset Bands editor's "By function" mode: the preset picker, the
// inline formula field, and the Import script button now live inside the subset
// editor, and Apply runs through the editor's own Apply button. The "Selected
// function" status line remains the observable proof of which function will run
// at Apply (and that the scripting worker populated a custom band).

// History entries still carry the pre-merge vocabulary ("Band Selection").
export const BAND_SELECTION_OPERATION_LABEL = "Band Selection";
export const SUBSET_BANDS_BY_FUNCTION_MODE_VALUE = "by-function";

const POPULATE_FROM_SCRIPT_TIMEOUT_MS = 20_000;

function bandSelectionFunctionPanel(page: Page): Locator {
  return subsetBandsEditor(page);
}

export function subsetBandsModeSelect(page: Page): Locator {
  return subsetBandsEditor(page).locator(
    `select:has(option[value="${SUBSET_BANDS_BY_FUNCTION_MODE_VALUE}"])`,
  );
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
  await expect(
    bandSelectionFunctionPanel(page).getByRole("button", { name: "Average", exact: true }),
  ).toBeVisible();
}

export async function clickBandSelectionPreset(page: Page, presetLabel: string): Promise<void> {
  await bandSelectionFunctionPanel(page).getByRole("button", { name: presetLabel, exact: true }).click();
}

export async function runBandSelectionFormula(page: Page, expression: string): Promise<void> {
  await bandSelectionFunctionPanel(page).getByLabel("Band formula", { exact: true }).fill(expression);
  await bandSelectionFunctionPanel(page).getByRole("button", { name: "Run formula", exact: true }).click();
}

export async function clickImportBandSelectionScript(page: Page): Promise<void> {
  await bandSelectionFunctionPanel(page).getByRole("button", { name: "Import script...", exact: true }).click();
}

export async function expectBandSelectionFunction(page: Page, expectedFunction: string): Promise<void> {
  await expect(
    bandSelectionFunctionPanel(page).getByText(`Selected function: ${expectedFunction}`, { exact: true }),
  ).toBeVisible({
    timeout: POPULATE_FROM_SCRIPT_TIMEOUT_MS,
  });
}
