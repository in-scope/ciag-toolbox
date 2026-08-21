import { expect } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";

import { listAllOperationCommands } from "../../src/shared/operation-menu-catalog";
import { electronApplicationForWindow } from "./launch-app";
import { triggerOperationMenuItem } from "./main-process";
import { runAsStoryboardStep } from "./storyboard-step";

// Operations are launched from their REAL user entry point, decided by the
// shared catalog: commands with a toolbar shortcut are clicked on the toolbar
// by accessible name; menu-only commands are clicked in the native operation
// menus (Edit, Image, Adjust, Process, Spectral). Each opens a tool-options
// panel rendered as <aside aria-label="<label> options"> containing an "Apply"
// and a "Cancel" button.

export function applicationToolbar(page: Page): Locator {
  return page.getByRole("toolbar", { name: "Application toolbar" });
}

export function operationPanel(page: Page, operationLabel: string): Locator {
  // The tool-options panel is an <aside aria-label="<label> options">; select it by
  // tag + aria-label (an <aside> nested in sectioning content is not always exposed
  // with the "complementary" role, so role selection would be unreliable here).
  return page.locator(`aside[aria-label="${operationLabel} options"]`);
}

function operationHasToolbarShortcut(operationLabel: string): boolean {
  return listAllOperationCommands().some(
    (command) => command.label === operationLabel && command.showInToolbar,
  );
}

async function launchOperationFromItsEntryPoint(
  page: Page,
  operationLabel: string,
): Promise<void> {
  if (operationHasToolbarShortcut(operationLabel)) {
    await applicationToolbar(page)
      .getByRole("button", { name: operationLabel, exact: true })
      .click();
    return;
  }
  await triggerOperationMenuItem(electronApplicationForWindow(page), operationLabel);
}

export async function openOperation(page: Page, operationLabel: string): Promise<Locator> {
  return runAsStoryboardStep(page, `Open the ${operationLabel} panel from its entry point`, async () => {
    await launchOperationFromItsEntryPoint(page, operationLabel);
    const panel = operationPanel(page, operationLabel);
    await expect(panel).toBeVisible();
    return panel;
  });
}

// Explicitly menu-driven launch (e.g. the broad "Rotate" and "Flip", whose toolbar
// slots are occupied by narrow one-click variants).
export async function openOperationFromMenu(
  app: ElectronApplication,
  page: Page,
  operationLabel: string,
): Promise<Locator> {
  return runAsStoryboardStep(page, `Open the ${operationLabel} panel from the menu`, async () => {
    await triggerOperationMenuItem(app, operationLabel);
    const panel = operationPanel(page, operationLabel);
    await expect(panel).toBeVisible();
    return panel;
  });
}

// CT-221/222/223: transforming operations run asynchronously (per-band progress
// ticks), so the operation panel closes immediately while a role="status" busy
// overlay sits on the result panel until the transform lands. Completion is that
// overlay clearing, not the panel hiding - specs that read the result right after
// applyOperation rely on this wait.
const OPERATION_TRANSFORM_COMPLETION_TIMEOUT_MS = 60_000;

export async function applyOperation(page: Page, operationLabel: string): Promise<void> {
  await runAsStoryboardStep(
    page,
    `Apply ${operationLabel} and wait for the result panel to settle`,
    async () => {
      await clickApplyInPanelAndAwaitResult(page, operationPanel(page, operationLabel));
    },
  );
}

// Shared by the tool-options panels and the Subset Bands editor (CT-284): click
// Apply inside the given container, wait for it to close, then wait for any
// async-transform busy overlay to clear.
export async function clickApplyInPanelAndAwaitResult(page: Page, panel: Locator): Promise<void> {
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(operationBusyOverlays(page)).toHaveCount(0, {
    timeout: OPERATION_TRANSFORM_COMPLETION_TIMEOUT_MS,
  });
}

function operationBusyOverlays(page: Page): Locator {
  return page
    .getByRole("grid", { name: "Panel grid" })
    .locator('[role="status"]')
    .filter({ has: page.locator("svg.animate-spin") });
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
  await runAsStoryboardStep(
    page,
    `Set ${operationLabel}'s "Open in a new panel" switch to ${shouldOpenInNewPanel ? "on" : "off"}`,
    async () => {
      const toggle = openInNewPanelSwitch(page, operationLabel);
      const isChecked = (await toggle.getAttribute("aria-checked")) === "true";
      if (isChecked !== shouldOpenInNewPanel) await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", String(shouldOpenInNewPanel));
    },
  );
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
  await runAsStoryboardStep(
    page,
    `Set ${parameterLabel} to ${value} in the ${operationLabel} panel`,
    async () => {
      const field = operationPanel(page, operationLabel).getByLabel(parameterLabel, {
        exact: true,
      });
      await field.fill(String(value));
      await expect(field).toHaveValue(String(value));
    },
  );
}

// Enum parameter fields (e.g. Normalize's "Method") render one native <select> in the panel;
// target it directly, as its wrapping <label> does not resolve reliably via getByLabel for a
// <select> (mirrors geometric-transform-operation.ts). Pass the option's value, not its label.
export async function setOperationEnumParameter(
  page: Page,
  operationLabel: string,
  optionValue: string,
): Promise<void> {
  await runAsStoryboardStep(
    page,
    `Choose the ${optionValue} option in the ${operationLabel} panel`,
    async () => {
      await operationPanel(page, operationLabel).locator("select").selectOption(optionValue);
    },
  );
}

export async function cancelOperation(page: Page, operationLabel: string): Promise<void> {
  await runAsStoryboardStep(page, `Cancel the ${operationLabel} panel`, async () => {
    const panel = operationPanel(page, operationLabel);
    await panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(panel).toBeHidden();
  });
}

export function isApplyEnabled(page: Page, operationLabel: string): Promise<boolean> {
  return operationPanel(page, operationLabel)
    .getByRole("button", { name: "Apply", exact: true })
    .isEnabled();
}
