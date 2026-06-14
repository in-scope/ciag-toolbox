import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Panels are role="gridcell" cells inside the role="grid" "Panel grid"; each
// viewport canvas is role="img" labelled "Panel N" (1-based). Selection is a
// plain click that sets aria-selected on the cell.

export function panelGrid(page: Page): Locator {
  return page.getByRole("grid", { name: "Panel grid" });
}

export function panelCell(page: Page, panelNumber: number): Locator {
  return panelGrid(page).getByRole("gridcell").nth(panelNumber - 1);
}

export function panelCanvas(page: Page, panelNumber: number): Locator {
  // The viewport canvas carries only aria-label (no role="img" like the histogram
  // canvas), so select it by tag + aria-label rather than by role.
  return page.locator(`canvas[aria-label="Panel ${panelNumber}"]`);
}

export async function selectPanel(page: Page, panelNumber: number): Promise<void> {
  await panelCell(page, panelNumber).click();
  await expect(panelCell(page, panelNumber)).toHaveAttribute("aria-selected", "true");
}

export async function countSelectedPanels(page: Page): Promise<number> {
  return panelGrid(page).getByRole("gridcell", { selected: true }).count();
}

export async function countPanels(page: Page): Promise<number> {
  return panelGrid(page).getByRole("gridcell").count();
}
