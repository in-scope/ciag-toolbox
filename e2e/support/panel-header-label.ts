import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { panelCell } from "./panels";

// The viewport header strip (viewport-header-label.ts) names what the panel is currently
// showing: "<fileName>[ (<lastOperation>)] - <active band identity>". For a stack with no
// explicit band labels the active-band suffix is "Band <originalNumber>", so the header is
// the user-facing proof that the label tracks every band-selection gesture (CT-094).
//
// It is the only <span title> inside a panel cell: the number badge span carries no title
// and the band navigator's "Remove band N" control is a <button>, so this locates the label
// unambiguously per panel. The title attribute holds the full (untruncated) text.

export function panelHeaderLabel(page: Page, panelNumber: number): Locator {
  return panelCell(page, panelNumber).locator("span[title]");
}

export async function readPanelHeaderLabel(page: Page, panelNumber: number): Promise<string> {
  return (await panelHeaderLabel(page, panelNumber).getAttribute("title")) ?? "";
}

export async function expectPanelHeaderToName(
  page: Page,
  panelNumber: number,
  fullLabel: string,
): Promise<void> {
  await expect(panelHeaderLabel(page, panelNumber)).toHaveAttribute("title", fullLabel);
}

// After a band-removal/subset the header also appends the operation label
// ("<file> (Kept bands ...) - Band N"), so assert only the trailing active-band suffix,
// which is the part CT-094 contracts to track the displayed band.
export async function expectPanelHeaderActiveBand(
  page: Page,
  panelNumber: number,
  bandNumber: number,
): Promise<void> {
  await expect(panelHeaderLabel(page, panelNumber)).toHaveAttribute(
    "title",
    new RegExp(`- Band ${bandNumber}$`),
  );
}

export async function expectPanelHeaderNotToName(
  page: Page,
  panelNumber: number,
  staleSubstring: string,
): Promise<void> {
  await expect(panelHeaderLabel(page, panelNumber)).not.toHaveAttribute(
    "title",
    new RegExp(escapeForRegularExpression(staleSubstring)),
  );
}

function escapeForRegularExpression(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
