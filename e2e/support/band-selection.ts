import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { operationPanel } from "./operations";

// CT-210: page objects for the Band Selection operation panel. The preset picker,
// the inline formula field, and the Import script button are all inside the panel;
// the "Selected function" status line is the observable proof of which function
// will run at Apply (and that the scripting worker populated a custom band).

export const BAND_SELECTION_OPERATION_LABEL = "Band Selection";

const POPULATE_FROM_SCRIPT_TIMEOUT_MS = 20_000;

function bandSelectionPanel(page: Page): Locator {
  return operationPanel(page, BAND_SELECTION_OPERATION_LABEL);
}

export async function expectBandSelectionEditorReady(page: Page): Promise<void> {
  await expect(bandSelectionPanel(page).getByRole("button", { name: "Average", exact: true })).toBeVisible();
}

export async function clickBandSelectionPreset(page: Page, presetLabel: string): Promise<void> {
  await bandSelectionPanel(page).getByRole("button", { name: presetLabel, exact: true }).click();
}

export async function runBandSelectionFormula(page: Page, expression: string): Promise<void> {
  await bandSelectionPanel(page).getByLabel("Band formula", { exact: true }).fill(expression);
  await bandSelectionPanel(page).getByRole("button", { name: "Run formula", exact: true }).click();
}

export async function clickImportBandSelectionScript(page: Page): Promise<void> {
  await bandSelectionPanel(page).getByRole("button", { name: "Import script...", exact: true }).click();
}

export async function expectBandSelectionFunction(page: Page, expectedFunction: string): Promise<void> {
  await expect(bandSelectionPanel(page).getByText(`Selected function: ${expectedFunction}`, { exact: true })).toBeVisible({
    timeout: POPULATE_FROM_SCRIPT_TIMEOUT_MS,
  });
}
