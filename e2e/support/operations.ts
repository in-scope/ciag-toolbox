import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Operations are launched from the application toolbar by their accessible name
// (the action label, e.g. "Normalize", "Bit Shift", "Flat-field Correction").
// Each opens a tool-options panel rendered as <aside aria-label="<label> options">
// containing an "Apply" and a "Cancel" button.

export function applicationToolbar(page: Page): Locator {
  return page.getByRole("toolbar", { name: "Application toolbar" });
}

export function operationPanel(page: Page, operationLabel: string): Locator {
  // The tool-options panel is an <aside aria-label="<label> options">; select it by
  // tag + aria-label (an <aside> nested in sectioning content is not always exposed
  // with the "complementary" role, so role selection would be unreliable here).
  return page.locator(`aside[aria-label="${operationLabel} options"]`);
}

export async function openOperation(page: Page, operationLabel: string): Promise<Locator> {
  await applicationToolbar(page).getByRole("button", { name: operationLabel, exact: true }).click();
  const panel = operationPanel(page, operationLabel);
  await expect(panel).toBeVisible();
  return panel;
}

export async function applyOperation(page: Page, operationLabel: string): Promise<void> {
  const panel = operationPanel(page, operationLabel);
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(panel).toBeHidden();
}

export async function cancelOperation(page: Page, operationLabel: string): Promise<void> {
  const panel = operationPanel(page, operationLabel);
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(panel).toBeHidden();
}

export function isApplyEnabled(page: Page, operationLabel: string): Promise<boolean> {
  return operationPanel(page, operationLabel)
    .getByRole("button", { name: "Apply", exact: true })
    .isEnabled();
}
