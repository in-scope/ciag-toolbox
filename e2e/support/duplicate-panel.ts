import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { panelCell } from "./panels";

// Stage-3 duplicate flow (manual section 10, redesigned from the Stage-1 "Duplicate to..."
// submenu). Right-clicking a populated panel opens a shadcn ContextMenu whose "Duplicate"
// item clones the panel into the lowest-index empty cell (growing the grid one step if
// needed). Only when the grid is already at its 6-cell maximum AND every cell is full does
// a shadcn Dialog ("Replace which panel?") ask which occupied panel to overwrite, with
// Cancel (leave unchanged) and Replace (overwrite). Right-click at the cell centre: the
// contextmenu event bubbles to the trigger without firing the left-click pixel-pin handler.

export async function openPanelContextMenu(page: Page, panelNumber: number): Promise<void> {
  await panelCell(page, panelNumber).click({ button: "right" });
  await expect(duplicateMenuItem(page)).toBeVisible();
}

export function duplicateMenuItem(page: Page): Locator {
  return page.getByRole("menuitem", { name: "Duplicate", exact: true });
}

export async function duplicatePanelViaContextMenu(page: Page, panelNumber: number): Promise<void> {
  await openPanelContextMenu(page, panelNumber);
  await duplicateMenuItem(page).click();
}

export function duplicateReplacePicker(page: Page): Locator {
  return page.getByRole("dialog", { name: "Replace which panel?" });
}

export async function chooseReplaceTargetPanel(
  page: Page,
  panelNumber: number,
  fileName: string,
): Promise<void> {
  await duplicateReplacePicker(page)
    .getByRole("radio", { name: `Panel ${panelNumber} (${fileName})` })
    .check();
}

export async function confirmReplaceWithChosenTarget(page: Page): Promise<void> {
  await duplicateReplacePicker(page).getByRole("button", { name: "Replace" }).click();
  await expect(duplicateReplacePicker(page)).toHaveCount(0);
}

export async function cancelReplacePicker(page: Page): Promise<void> {
  await duplicateReplacePicker(page).getByRole("button", { name: "Cancel" }).click();
  await expect(duplicateReplacePicker(page)).toHaveCount(0);
}
