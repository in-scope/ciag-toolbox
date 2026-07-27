import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { panelCell } from "./panels";

// CT-207: helpers for linked pan & zoom. Linking is driven from a panel's shadcn
// ContextMenu ("Link pan & zoom" / "Unlink pan & zoom"), acting on the current
// multi-selection. A linked panel shows a Link2 badge ("Linked pan and zoom") in
// its header strip; a different-size link attempt raises a sonner error toast.

const CONTEXT_MENU_CLICK_POSITION = { x: 8, y: 8 } as const;

export function linkPanZoomMenuItem(page: Page): Locator {
  return page.getByRole("menuitem", { name: "Link pan & zoom", exact: true });
}

export function unlinkPanZoomMenuItem(page: Page): Locator {
  return page.getByRole("menuitem", { name: "Unlink pan & zoom", exact: true });
}

export async function openPanelContextMenuAtCorner(page: Page, panelNumber: number): Promise<void> {
  await panelCell(page, panelNumber).click({
    button: "right",
    position: { ...CONTEXT_MENU_CLICK_POSITION },
  });
}

export async function linkPanZoomFromPanelContextMenu(page: Page, panelNumber: number): Promise<void> {
  await openPanelContextMenuAtCorner(page, panelNumber);
  await linkPanZoomMenuItem(page).click();
}

export function linkedPanelBadge(page: Page, panelNumber: number): Locator {
  return panelCell(page, panelNumber).getByLabel("Linked pan and zoom");
}

export async function expectPanelIsLinked(page: Page, panelNumber: number): Promise<void> {
  await expect(linkedPanelBadge(page, panelNumber)).toBeVisible();
}

export async function expectPanelIsNotLinked(page: Page, panelNumber: number): Promise<void> {
  await expect(linkedPanelBadge(page, panelNumber)).toHaveCount(0);
}

export function differentSizeLinkErrorToast(page: Page): Locator {
  return page.getByText("Only panels of the same size can be linked.", { exact: false });
}
