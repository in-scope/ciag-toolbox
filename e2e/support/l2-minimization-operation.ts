import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { operationPanel } from "./operations";
import { runAsStoryboardStep } from "./storyboard-step";

// CT-313: L2 Minimization is an ordinary tool-options panel (a
// RegisteredViewportAction, unlike NPC/ROP's own asides), so its "Mask layer"
// field follows the SAME unassociated span+DropdownMenu shape as Concatenate
// Stacks' "Second stack" field (parameter-form-section.tsx's
// MaskLayerParameterField): locate the field container by its label text,
// not by getByLabel.

export const L2_MINIMIZATION_LABEL = "L2 Minimization";

export function l2MinimizationMaskLayerField(page: Page): Locator {
  return operationPanel(page, L2_MINIMIZATION_LABEL)
    .getByText("Mask layer", { exact: true })
    .locator("xpath=..");
}

export function l2MinimizationLowerValueField(page: Page): Locator {
  return operationPanel(page, L2_MINIMIZATION_LABEL).getByLabel("Lower value");
}

export function l2MinimizationUpperValueField(page: Page): Locator {
  return operationPanel(page, L2_MINIMIZATION_LABEL).getByLabel("Upper value");
}

export async function expectL2MinimizationDefaultsToTheLayer(
  page: Page,
  layerName: string,
): Promise<void> {
  await runAsStoryboardStep(page, `The panel defaults to the mask layer "${layerName}"`, async () => {
    await expect(l2MinimizationMaskLayerField(page).getByRole("button", { name: layerName })).toBeVisible();
    await expect(l2MinimizationLowerValueField(page)).toHaveValue("0");
    await expect(l2MinimizationUpperValueField(page)).toHaveValue("1");
  });
}
