import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// The right panel is the <aside aria-label="Panel details"> on the right of the stage. Each
// visible section renders as a <section aria-label="..."> in a fixed DOM order: Metadata,
// Histogram, Spectra, Region, History (CT-092). The persistent Bands list and the Pixel
// Inspector section were removed in CT-092, so neither should appear anywhere in the panel.

export const FIXED_RIGHT_PANEL_SECTION_ORDER: ReadonlyArray<string> = [
  "Metadata",
  "Histogram",
  "Spectra",
  "Region",
  "History",
];

export function rightPanel(page: Page): Locator {
  return page.locator('aside[aria-label="Panel details"]');
}

export function rightPanelSections(page: Page): Locator {
  return rightPanel(page).locator("section[aria-label]");
}

export async function readRightPanelSectionLabelsInOrder(page: Page): Promise<string[]> {
  return rightPanelSections(page).evaluateAll((sections) =>
    sections.map((section) => section.getAttribute("aria-label") ?? ""),
  );
}

export async function expectRightPanelSectionsInFixedOrder(page: Page): Promise<void> {
  await expect(rightPanelSections(page)).toHaveCount(FIXED_RIGHT_PANEL_SECTION_ORDER.length);
  expect(await readRightPanelSectionLabelsInOrder(page)).toEqual(FIXED_RIGHT_PANEL_SECTION_ORDER);
}

export async function expectNoRemovedRightPanelSections(page: Page): Promise<void> {
  await expect(rightPanel(page).locator('section[aria-label="Bands"]')).toHaveCount(0);
  await expect(rightPanel(page).locator('section[aria-label="Pixel Inspector"]')).toHaveCount(0);
  await expect(rightPanel(page).getByText("Pixel Inspector")).toHaveCount(0);
}
