import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { operationPanel } from "./operations";

// CT-216: page objects for the Custom Transform operation panel. The inline
// formula field and the Import script button are inside the panel; the
// "Transform ready: ..." status line (which names the input form and the output
// band count) is the observable proof the scripting worker produced a cube.

export const CUSTOM_TRANSFORM_OPERATION_LABEL = "Custom Transform";

const POPULATE_FROM_SCRIPT_TIMEOUT_MS = 20_000;

function customTransformPanel(page: Page): Locator {
  return operationPanel(page, CUSTOM_TRANSFORM_OPERATION_LABEL);
}

export async function expectCustomTransformEditorReady(page: Page): Promise<void> {
  await expect(
    customTransformPanel(page).getByRole("button", { name: "Run formula", exact: true }),
  ).toBeVisible();
}

export async function runCustomTransformFormula(page: Page, expression: string): Promise<void> {
  await customTransformPanel(page).getByLabel("Transform formula", { exact: true }).fill(expression);
  await customTransformPanel(page).getByRole("button", { name: "Run formula", exact: true }).click();
}

export async function clickImportCustomTransformScript(page: Page): Promise<void> {
  await customTransformPanel(page).getByRole("button", { name: "Import script...", exact: true }).click();
}

export async function expectCustomTransformReady(
  page: Page,
  expectedStatusText: string,
): Promise<void> {
  await expect(
    customTransformPanel(page).getByText(`Transform ready: ${expectedStatusText}`, { exact: true }),
  ).toBeVisible({ timeout: POPULATE_FROM_SCRIPT_TIMEOUT_MS });
}
