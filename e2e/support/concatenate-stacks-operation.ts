import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { operationPanel } from "./operations";

// Concatenate Stacks (CT-300): the tool-options panel holds one raster-reference
// field, "Second stack", restricted to already-loaded panels whose stack matches
// the active stack's width and height. There is no file-on-disk picker (an
// undecoded file's dimensions are unknown), so this field only ever offers the
// "Use a loaded panel..." dropdown or an explanatory message when nothing qualifies.

export const CONCATENATE_STACKS_LABEL = "Concatenate Stacks";
const SECOND_STACK_FIELD_LABEL = "Second stack";

export function concatenateStacksSecondStackField(page: Page): Locator {
  return operationPanel(page, CONCATENATE_STACKS_LABEL)
    .getByText(SECOND_STACK_FIELD_LABEL, { exact: true })
    .locator("xpath=..");
}

export async function chooseLoadedPanelAsSecondStack(
  page: Page,
  panelOptionLabel: string,
): Promise<void> {
  const field = concatenateStacksSecondStackField(page);
  await field.getByRole("button", { name: "Use a loaded panel..." }).click();
  await page.getByRole("menuitem", { name: panelOptionLabel, exact: true }).click();
  await expect(field.getByText(panelOptionLabel, { exact: true })).toBeVisible();
}
