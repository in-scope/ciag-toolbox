import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { operationPanel } from "./operations";

// The "Apply to" scope selector (tool-options-panel.tsx ApplyScopeSelectorSection) shows for
// any action offering a scope choice: supportsRoiScope actions (dimension reduction) get the
// default "Whole stack" / "Region of interest" radio pair, where selecting "Region of
// interest" reveals the shared CT-095 operation-region picker; the tone curve supplies its
// own "Full image" / "Whole stack" pair (CT-192, ROI scope removed in CT-244). It is a
// <fieldset> (role group) with legend "Apply to" holding native radios. This is distinct
// from the Normalize/Standardize "Scope" control (full stack vs band-wise, cube-scope-control).

export const APPLY_SCOPE_GROUP_NAME = "Apply to";
export const WHOLE_STACK_SCOPE_LABEL = "Whole stack";
export const REGION_OF_INTEREST_SCOPE_LABEL = "Region of interest";
// CT-192: the tone curve relabels the whole-image scope "Full image" alongside its
// distinct "Whole stack" scope (one curve shape across every band).
export const FULL_IMAGE_SCOPE_LABEL = "Full image";

export function applyScopeFieldset(page: Page, operationLabel: string): Locator {
  return operationPanel(page, operationLabel).getByRole("group", { name: APPLY_SCOPE_GROUP_NAME });
}

export function applyScopeRadio(page: Page, operationLabel: string, scopeLabel: string): Locator {
  return applyScopeFieldset(page, operationLabel).getByRole("radio", { name: scopeLabel });
}

export async function selectFullImageScope(page: Page, operationLabel: string): Promise<void> {
  const radio = applyScopeRadio(page, operationLabel, FULL_IMAGE_SCOPE_LABEL);
  await radio.check();
  await expect(radio).toBeChecked();
}

export async function selectRegionOfInterestScope(page: Page, operationLabel: string): Promise<void> {
  const radio = applyScopeRadio(page, operationLabel, REGION_OF_INTEREST_SCOPE_LABEL);
  await radio.check();
  await expect(radio).toBeChecked();
}

export async function selectWholeStackScope(page: Page, operationLabel: string): Promise<void> {
  const radio = applyScopeRadio(page, operationLabel, WHOLE_STACK_SCOPE_LABEL);
  await radio.check();
  await expect(radio).toBeChecked();
}
