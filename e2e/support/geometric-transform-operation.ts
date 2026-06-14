import type { Locator, Page } from "@playwright/test";

import { applyOperationInPlace, openOperation, operationPanel } from "./operations";

// CT-146 / manual section 13 (CT-087): "Rotate & Reflect" is a single enum operation. Its
// "Transform" parameter renders as a native <select> (EnumParameterField) whose option
// values are the GeometricTransform ids and whose option labels are the offered choices, so
// getByLabel("Transform") targets it via the wrapping <label>. Each apply records ONE History
// entry whose detail is the chosen transform's label (formatGeometricTransformAppliedLabel).

export const ROTATE_REFLECT_LABEL = "Rotate & Reflect";

export type GeometricTransformChoice =
  | "rotate-90-cw"
  | "rotate-180"
  | "rotate-270-cw"
  | "flip-horizontal"
  | "flip-vertical";

export function geometricTransformSelect(page: Page): Locator {
  // The enum parameter renders one native <select> in the panel; target it directly (its
  // accessible name comes from a wrapping <label> that also encloses the control, which
  // getByLabel does not resolve reliably for a <select>).
  return operationPanel(page, ROTATE_REFLECT_LABEL).locator("select");
}

export function readOfferedGeometricTransformLabels(page: Page): Promise<string[]> {
  return geometricTransformSelect(page).locator("option").allInnerTexts();
}

export async function selectGeometricTransform(
  page: Page,
  choice: GeometricTransformChoice,
): Promise<void> {
  await geometricTransformSelect(page).selectOption(choice);
}

export async function applyGeometricTransformInPlace(
  page: Page,
  choice: GeometricTransformChoice,
): Promise<void> {
  await openOperation(page, ROTATE_REFLECT_LABEL);
  await selectGeometricTransform(page, choice);
  await applyOperationInPlace(page, ROTATE_REFLECT_LABEL);
}
