import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { applicationToolbar, selectResultDestinationSegment } from "./operations";

// CT-131 band keep/remove + subset helpers.
//
// REMOVE-ONE: the viewport band navigator renders a "Remove band N" button (a trash icon) for the
// currently displayed band. Clicking it removes that single band IN PLACE through the same
// engine as Subset Bands (App.removeSingleBandFromViewportInPlace -> BAND_SUBSET_ACTION),
// so the band count drops by one and a "Subset Bands" History entry records the kept bands
// by original number ("Kept bands 1, 3 of the original stack").
//
// SUBSET MODE: the toolbar "Subset Bands" toggle (aria-pressed) opens a transient editor
// section (aria-label "Subset bands") with a "Bands to keep" checkbox list, a "Result"
// segmented control (CT-291), and Apply/Cancel. Unchecking a set then Apply removes those bands.

export function removeBandButton(page: Page, bandNumber: number): Locator {
  return page.getByRole("button", { name: `Remove band ${bandNumber}` });
}

// CT-254: the trash button no longer removes directly; it opens a confirmation
// AlertDialog ("Remove band N?") and the removal runs only after the destructive
// "Remove band" button is confirmed. Cancel (button or Esc) leaves the stack untouched.
export function removeBandConfirmationDialog(page: Page): Locator {
  return page.getByRole("alertdialog", { name: /^Remove band \d+\?$/ });
}

export async function removeDisplayedBand(page: Page, bandNumber: number): Promise<void> {
  await removeBandButton(page, bandNumber).click();
  await confirmPendingBandRemoval(page);
}

export async function confirmPendingBandRemoval(page: Page): Promise<void> {
  const dialog = removeBandConfirmationDialog(page);
  await dialog.getByRole("button", { name: "Remove band", exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function cancelPendingBandRemoval(page: Page): Promise<void> {
  const dialog = removeBandConfirmationDialog(page);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
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

// CT-283: the typed index list above the checkbox list. A valid expression checks
// exactly those bands; invalid text shows the parse error and changes no selection.
export function subsetBandsTypedRangeField(page: Page): Locator {
  return subsetBandsEditor(page).getByRole("textbox", { name: "Bands to keep" });
}

export async function typeSubsetBandsRange(page: Page, text: string): Promise<void> {
  await subsetBandsTypedRangeField(page).fill(text);
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
  await selectResultDestinationSegment(subsetBandsEditor(page), shouldOpen);
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
