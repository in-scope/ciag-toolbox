import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { operationPanel } from "./operations";

// CT-135 / CT-076: the shared "scope" control that Normalize and Standardize both embed.
// It renders as a <fieldset> (role "group") named by its "Scope" <legend>, holding exactly
// two <input type="radio"> rows whose accessible names come from the wrapping <label> text.
// The CURRENT app wording is "Full stack" and "Band-wise (enter bands)" (the older manual
// script's "Full cube" / "Band-wise (selected bands)" is stale, per the CT-110 note).
// Selecting band-wise reveals a "Bands to process" range textbox; an empty/invalid range
// blocks Apply, so a band-wise apply must enter a valid range first.

export const FULL_STACK_SCOPE_LABEL = "Full stack";
export const BAND_WISE_SCOPE_LABEL = "Band-wise (enter bands)";
export const SHARED_SCOPE_OPTION_LABELS = [FULL_STACK_SCOPE_LABEL, BAND_WISE_SCOPE_LABEL] as const;

export function scopeFieldset(page: Page, operationLabel: string): Locator {
  return operationPanel(page, operationLabel).getByRole("group", { name: "Scope", exact: true });
}

export function scopeOptionRadios(page: Page, operationLabel: string): Locator {
  return scopeFieldset(page, operationLabel).getByRole("radio");
}

export function scopeOptionRadio(page: Page, operationLabel: string, scopeLabel: string): Locator {
  return scopeFieldset(page, operationLabel).getByRole("radio", { name: scopeLabel, exact: true });
}

export async function expectScopeControlOffersExactlyTheSharedTwoOptions(
  page: Page,
  operationLabel: string,
): Promise<void> {
  await expect(scopeOptionRadios(page, operationLabel)).toHaveCount(SHARED_SCOPE_OPTION_LABELS.length);
  for (const scopeLabel of SHARED_SCOPE_OPTION_LABELS) {
    await expect(scopeOptionRadio(page, operationLabel, scopeLabel)).toBeVisible();
  }
}

export async function selectFullStackScope(page: Page, operationLabel: string): Promise<void> {
  await checkScopeRadio(scopeOptionRadio(page, operationLabel, FULL_STACK_SCOPE_LABEL));
}

export async function selectBandWiseScopeForBands(
  page: Page,
  operationLabel: string,
  bandRangeText: string,
): Promise<void> {
  await checkScopeRadio(scopeOptionRadio(page, operationLabel, BAND_WISE_SCOPE_LABEL));
  await fillBandsToProcessRange(page, operationLabel, bandRangeText);
}

async function checkScopeRadio(radio: Locator): Promise<void> {
  await radio.check();
  await expect(radio).toBeChecked();
}

async function fillBandsToProcessRange(
  page: Page,
  operationLabel: string,
  bandRangeText: string,
): Promise<void> {
  const input = operationPanel(page, operationLabel).getByRole("textbox", { name: "Bands to process" });
  await input.fill(bandRangeText);
  await expect(input).toHaveValue(bandRangeText);
}
