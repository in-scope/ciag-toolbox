import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { applicationToolbar } from "./operations";
import { panelCell } from "./panels";

// The Grid Layout control is a shadcn DropdownMenu in the toolbar. Its trigger's
// accessible name embeds the current layout ("Grid layout (currently 1x1)"), so we
// match the stable "Grid layout" prefix. The options are role="menuitemradio" items
// whose accessible name is the layout token ("1x1", "2x3", ...). A populated panel
// renders a "Close panel N" button; an empty panel renders the "No stack loaded"
// empty state, so those two signals distinguish retained from regrown-empty panels.

export function gridLayoutDropdownTrigger(page: Page): Locator {
  return applicationToolbar(page).getByRole("button", { name: /^Grid layout/ });
}

export function gridLayoutOptions(page: Page): Locator {
  return page.getByRole("menuitemradio");
}

export async function openGridLayoutDropdown(page: Page): Promise<void> {
  await gridLayoutDropdownTrigger(page).click();
  await expect(gridLayoutOptions(page).first()).toBeVisible();
}

export async function readOfferedGridLayoutLabels(page: Page): Promise<string[]> {
  await openGridLayoutDropdown(page);
  const labels = await gridLayoutOptions(page).allInnerTexts();
  await closeGridLayoutDropdown(page);
  return labels.map((label) => label.trim());
}

export async function selectGridLayout(page: Page, layoutLabel: string): Promise<void> {
  await openGridLayoutDropdown(page);
  await page.getByRole("menuitemradio", { name: layoutLabel, exact: true }).click();
  await expect(gridLayoutOptions(page)).toHaveCount(0);
}

async function closeGridLayoutDropdown(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(gridLayoutOptions(page)).toHaveCount(0);
}

export function panelCloseButton(page: Page, panelNumber: number): Locator {
  return panelCell(page, panelNumber).getByRole("button", {
    name: `Close panel ${panelNumber}`,
  });
}

export async function expectPanelHoldsFile(
  page: Page,
  panelNumber: number,
  fileName: string,
): Promise<void> {
  await expect(panelCell(page, panelNumber).getByText(fileName, { exact: false }).first()).toBeVisible();
  await expect(panelCloseButton(page, panelNumber)).toBeVisible();
}

export async function expectPanelIsEmpty(page: Page, panelNumber: number): Promise<void> {
  await expect(panelCell(page, panelNumber).getByText("No stack loaded")).toBeVisible();
  await expect(panelCloseButton(page, panelNumber)).toHaveCount(0);
}

export function closedPanelsToast(page: Page): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: /Closed panels?/ });
}
