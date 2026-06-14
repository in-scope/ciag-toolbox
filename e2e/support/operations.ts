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

// The operation panel defaults to "Open in a new panel" ON, so Apply places the result in a
// FRESH panel and leaves the source untouched. An in-place spec (asserting the SOURCE panel's
// readout/Metadata/History changed) must turn that switch off first; otherwise the source keeps
// its pre-op values and the History entry lands on the new result panel, not the source.
export function openInNewPanelSwitch(page: Page, operationLabel: string): Locator {
  return operationPanel(page, operationLabel).getByRole("switch", { name: "Open in a new panel" });
}

export async function setOpenInNewPanel(
  page: Page,
  operationLabel: string,
  shouldOpenInNewPanel: boolean,
): Promise<void> {
  const toggle = openInNewPanelSwitch(page, operationLabel);
  const isChecked = (await toggle.getAttribute("aria-checked")) === "true";
  if (isChecked !== shouldOpenInNewPanel) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(shouldOpenInNewPanel));
}

export async function applyOperationInPlace(page: Page, operationLabel: string): Promise<void> {
  await setOpenInNewPanel(page, operationLabel, false);
  await applyOperation(page, operationLabel);
}

// Numeric parameter fields (e.g. Standardize's "Target mean" / "Target standard deviation")
// render as a <label> wrapping the value text and a type=number input, so the input's
// accessible name is the label text; getByLabel(exact) targets one field unambiguously.
export async function setOperationNumberParameter(
  page: Page,
  operationLabel: string,
  parameterLabel: string,
  value: number,
): Promise<void> {
  const field = operationPanel(page, operationLabel).getByLabel(parameterLabel, { exact: true });
  await field.fill(String(value));
  await expect(field).toHaveValue(String(value));
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
