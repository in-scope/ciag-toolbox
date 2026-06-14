import { expect } from "@playwright/test";
import { basename } from "node:path";
import type { Locator, Page } from "@playwright/test";

import { enqueueOpenDialogPaths } from "./dialog-stub-controls";
import { operationPanel } from "./operations";

// Flat-field Correction (CT-078 / CT-111): the tool-options panel holds two
// raster-reference fields, "Light reference (required)" and "Dark reference
// (optional)". Each field can be satisfied from a file on disk ("Choose file...",
// routed through the CT-113 open-dialog stub) OR from an already-loaded panel
// ("Use a loaded panel..." dropdown). Both fields render identical button text,
// so every gesture is scoped to its field by the field's label span.

export const FLAT_FIELD_LABEL = "Flat-field Correction";
export const FLAT_FIELD_LIGHT_FIELD_LABEL = "Light reference (required)";
export const FLAT_FIELD_DARK_FIELD_LABEL = "Dark reference (optional)";

export function flatFieldReferenceField(page: Page, fieldLabel: string): Locator {
  return operationPanel(page, FLAT_FIELD_LABEL)
    .getByText(fieldLabel, { exact: true })
    .locator("xpath=..");
}

export async function chooseLoadedPanelAsFlatFieldReference(
  page: Page,
  fieldLabel: string,
  panelOptionLabel: string,
): Promise<void> {
  const field = flatFieldReferenceField(page, fieldLabel);
  await field.getByRole("button", { name: "Use a loaded panel..." }).click();
  await page.getByRole("menuitem", { name: panelOptionLabel, exact: true }).click();
  await expect(field.getByText(panelOptionLabel, { exact: true })).toBeVisible();
}

export async function chooseFlatFieldReferenceFileThroughDialog(
  page: Page,
  fieldLabel: string,
  absoluteFilePath: string,
): Promise<void> {
  await enqueueOpenDialogPaths(page, [absoluteFilePath]);
  const field = flatFieldReferenceField(page, fieldLabel);
  await field.getByRole("button", { name: /^(Choose file|Replace file)/ }).click();
  await expect(field.getByText(basename(absoluteFilePath), { exact: true })).toBeVisible();
}

export function flatFieldErrorToast(page: Page): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: `${FLAT_FIELD_LABEL} failed` });
}
