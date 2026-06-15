import type { ElectronApplication, Locator, Page } from "@playwright/test";

import {
  applicationToolbar,
  applyOperationInPlace,
  openOperationFromImageMenu,
  operationPanel,
} from "./operations";

// CT-146 / manual section 13 (CT-087): "Rotate" and "Reflect" are two separate enum
// operations, each with its own Image-menu entry and side panel. Rotate offers the three
// rotations (including the rotate-180 that has no one-click button); Reflect offers the two
// flips. Each panel's parameter renders as a native <select> (EnumParameterField) whose option
// values are the GeometricTransform ids and whose option labels are the offered choices. Each
// apply records ONE History entry whose action label is the operation name ("Rotate" or
// "Reflect") and whose detail is the chosen transform's label (formatGeometricTransformAppliedLabel).

export const ROTATE_LABEL = "Rotate";
export const REFLECT_LABEL = "Reflect";

export type GeometricTransformChoice =
  | "rotate-90-cw"
  | "rotate-180"
  | "rotate-270-cw"
  | "flip-horizontal"
  | "flip-vertical";

const REFLECTION_CHOICES: ReadonlyArray<GeometricTransformChoice> = ["flip-horizontal", "flip-vertical"];

export function isReflectionChoice(choice: GeometricTransformChoice): boolean {
  return REFLECTION_CHOICES.includes(choice);
}

export function geometricTransformOperationLabel(choice: GeometricTransformChoice): string {
  return isReflectionChoice(choice) ? REFLECT_LABEL : ROTATE_LABEL;
}

export function geometricTransformSelect(page: Page, choice: GeometricTransformChoice): Locator {
  // The enum parameter renders one native <select> in the operation's panel; target it directly
  // (its accessible name comes from a wrapping <label> that also encloses the control, which
  // getByLabel does not resolve reliably for a <select>).
  return operationPanel(page, geometricTransformOperationLabel(choice)).locator("select");
}

export function readOfferedGeometricTransformLabels(
  page: Page,
  choice: GeometricTransformChoice,
): Promise<string[]> {
  return geometricTransformSelect(page, choice).locator("option").allInnerTexts();
}

export async function selectGeometricTransform(
  page: Page,
  choice: GeometricTransformChoice,
): Promise<void> {
  await geometricTransformSelect(page, choice).selectOption(choice);
}

export function openGeometricTransformFromMenu(
  app: ElectronApplication,
  page: Page,
  choice: GeometricTransformChoice,
): Promise<Locator> {
  return openOperationFromImageMenu(app, page, geometricTransformOperationLabel(choice));
}

export async function applyGeometricTransformInPlace(
  app: ElectronApplication,
  page: Page,
  choice: GeometricTransformChoice,
): Promise<void> {
  const operationLabel = geometricTransformOperationLabel(choice);
  await openGeometricTransformFromMenu(app, page, choice);
  await selectGeometricTransform(page, choice);
  await applyOperationInPlace(page, operationLabel);
}

// The toolbar carries one-click variants of the four rotate/reflect presets (no rotate-180);
// each applies the transform IN PLACE directly, never opening the operation panel.
export type QuickGeometricTransformChoice = Exclude<GeometricTransformChoice, "rotate-180">;

const QUICK_TRANSFORM_BUTTON_LABELS: Record<QuickGeometricTransformChoice, string> = {
  "rotate-90-cw": "Rotate 90° clockwise",
  "rotate-270-cw": "Rotate 90° counterclockwise",
  "flip-horizontal": "Reflect horizontally",
  "flip-vertical": "Reflect vertically",
};

export function quickTransformToolbarButton(
  page: Page,
  choice: QuickGeometricTransformChoice,
): Locator {
  return applicationToolbar(page).getByRole("button", {
    name: QUICK_TRANSFORM_BUTTON_LABELS[choice],
    exact: true,
  });
}

export async function applyQuickGeometricTransform(
  page: Page,
  choice: QuickGeometricTransformChoice,
): Promise<void> {
  await quickTransformToolbarButton(page, choice).click();
}
