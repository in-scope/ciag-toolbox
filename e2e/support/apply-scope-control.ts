import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { operationPanel } from "./operations";

// The "Apply to" scope selector (tool-options-panel.tsx ApplyScopeSelectorSection) shows for
// any action with supportsRoiScope (e.g. Tone Curve, CT-139). It is a <fieldset> (role group)
// with legend "Apply to" holding two native radios: "Whole stack" (whole-image scope) and
// "Region of interest" (roi scope). Selecting "Region of interest" reveals the shared CT-095
// operation-region picker so the operation remaps ONLY the selected region. This is distinct
// from the Normalize/Standardize "Scope" control (full stack vs band-wise, cube-scope-control).

export const APPLY_SCOPE_GROUP_NAME = "Apply to";
export const WHOLE_STACK_SCOPE_LABEL = "Whole stack";
export const REGION_OF_INTEREST_SCOPE_LABEL = "Region of interest";
// CT-192: the tone curve relabels the whole-image scope "Full image" and adds a
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
