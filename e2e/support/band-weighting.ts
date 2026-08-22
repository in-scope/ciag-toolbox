import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { operationPanel } from "./operations";

// CT-209: page objects for the Weighted Sum (internally band-weighting) operation
// panel. The per-band weight fields, the reset helpers, the inline formula field,
// and the Import script button are all inside the panel; a formula/imported-tool
// result fills the same weight fields, which is the observable proof the scripting
// worker ran. CT-289 renamed the user-facing label; the constant name keeps the
// internal vocabulary.

export const BAND_WEIGHTING_OPERATION_LABEL = "Weighted Sum";

const POPULATE_FROM_SCRIPT_TIMEOUT_MS = 20_000;

function bandWeightingPanel(page: Page): Locator {
  return operationPanel(page, BAND_WEIGHTING_OPERATION_LABEL);
}

export function bandWeightField(page: Page, bandNumber: number): Locator {
  return bandWeightingPanel(page).getByLabel(`Weight for band ${bandNumber}`, { exact: true });
}

export async function expectBandWeightingEditorReady(page: Page): Promise<void> {
  await expect(bandWeightField(page, 1)).toBeVisible();
}

export async function setBandWeightField(page: Page, bandNumber: number, value: number): Promise<void> {
  const field = bandWeightField(page, bandNumber);
  await field.fill(String(value));
  await field.press("Enter");
  await expect(field).toHaveValue(String(value));
}

export async function clickResetAllWeightsToOne(page: Page): Promise<void> {
  await bandWeightingPanel(page).getByRole("button", { name: "Set all weights to 1", exact: true }).click();
}

export async function clickResetAllWeightsToZero(page: Page): Promise<void> {
  await bandWeightingPanel(page).getByRole("button", { name: "Set all weights to 0", exact: true }).click();
}

export async function runBandWeightingFormula(page: Page, expression: string): Promise<void> {
  await bandWeightingPanel(page).getByLabel("Weight formula", { exact: true }).fill(expression);
  await bandWeightingPanel(page).getByRole("button", { name: "Run formula", exact: true }).click();
}

export async function clickImportBandWeightingScript(page: Page): Promise<void> {
  await bandWeightingPanel(page).getByRole("button", { name: "Import script...", exact: true }).click();
}

export async function expectBandWeightFieldsToEqual(
  page: Page,
  expectedValues: ReadonlyArray<string>,
): Promise<void> {
  for (let index = 0; index < expectedValues.length; index += 1) {
    await expect(bandWeightField(page, index + 1)).toHaveValue(expectedValues[index]!, {
      timeout: POPULATE_FROM_SCRIPT_TIMEOUT_MS,
    });
  }
}
