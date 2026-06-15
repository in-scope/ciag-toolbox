import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { applicationToolbar } from "./operations";

// CT-131 band keep/remove + subset helpers.
//
// REMOVE-ONE: the viewport band navigator renders a "Remove band N" button (a trash icon) for the
// currently displayed band. Clicking it removes that single band IN PLACE through the same
// engine as Subset Bands (App.removeSingleBandFromViewportInPlace -> BAND_SUBSET_ACTION),
// so the band count drops by one and a "Subset Bands" History entry records the kept bands
// by original number ("Kept bands 1, 3 of the original stack").
//
// SUBSET MODE: the toolbar "Subset Bands" toggle (aria-pressed) opens a transient editor
// section (aria-label "Subset bands") with a "Bands to keep" checkbox list, an "Open in a
// new panel" switch, and Apply/Cancel. Unchecking a set then Apply removes those bands.

export function removeBandButton(page: Page, bandNumber: number): Locator {
  return page.getByRole("button", { name: `Remove band ${bandNumber}` });
}

export async function removeDisplayedBand(page: Page, bandNumber: number): Promise<void> {
  await removeBandButton(page, bandNumber).click();
}

export function subsetBandsToggleButton(page: Page): Locator {
  return applicationToolbar(page).getByRole("button", { name: /^Subset Bands/ });
}

export function subsetBandsEditor(page: Page): Locator {
  return page.locator("section[aria-label='Subset bands']");
}

export async function openSubsetBandsEditor(page: Page): Promise<Locator> {
  await subsetBandsToggleButton(page).click();
  const editor = subsetBandsEditor(page);
  await expect(editor).toBeVisible();
  return editor;
}

export function subsetBandsKeepCheckboxes(page: Page): Locator {
  return subsetBandsEditor(page)
    .getByRole("list", { name: "Bands to keep" })
    .getByRole("checkbox");
}

export async function uncheckSubsetBandRow(page: Page, oneBasedRowNumber: number): Promise<void> {
  const checkbox = subsetBandsKeepCheckboxes(page).nth(oneBasedRowNumber - 1);
  if ((await checkbox.getAttribute("aria-checked")) === "true") await checkbox.click();
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
}

export async function setSubsetBandsOpenInNewPanel(page: Page, shouldOpen: boolean): Promise<void> {
  const toggle = subsetBandsEditor(page).getByRole("switch", { name: "Open in a new panel" });
  const isChecked = (await toggle.getAttribute("aria-checked")) === "true";
  if (isChecked !== shouldOpen) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(shouldOpen));
}

export async function applySubsetBands(page: Page): Promise<void> {
  const editor = subsetBandsEditor(page);
  await editor.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(editor).toBeHidden();
}

export async function closeSubsetBandsEditorWithoutApplying(page: Page): Promise<void> {
  const editor = subsetBandsEditor(page);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeHidden();
}
