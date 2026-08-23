import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { enqueueOpenDialogPaths, enqueueSaveDialogPath } from "./dialog-stub-controls";
import { masksOptionsPanel } from "./masks-panel";
import { runAsStoryboardStep } from "./storyboard-step";

// CT-303: the Masks aside's Import/Export row. Import picks a mask PNG through
// the stubbed open dialog (its JSON sidecar, if any, is found by name in main);
// Export writes the SELECTED layer's PNG plus sidecar to the stubbed save path.

export function importMaskButton(page: Page): Locator {
  return masksOptionsPanel(page).getByRole("button", { name: "Import mask", exact: true });
}

export function exportMaskButton(page: Page): Locator {
  return masksOptionsPanel(page).getByRole("button", { name: "Export mask", exact: true });
}

export async function importMaskFromPath(page: Page, maskFilePath: string): Promise<void> {
  await runAsStoryboardStep(page, `Import the mask at ${maskFilePath}`, async () => {
    await enqueueOpenDialogPaths(page, [maskFilePath]);
    await importMaskButton(page).click();
  });
}

export async function exportSelectedMaskToPath(
  page: Page,
  destinationPath: string,
): Promise<void> {
  await runAsStoryboardStep(page, `Export the selected mask to ${destinationPath}`, async () => {
    await enqueueSaveDialogPath(page, destinationPath);
    await exportMaskButton(page).click();
    await expect(maskToastContaining(page, "Saved mask to")).toBeVisible();
  });
}

export function maskToastContaining(page: Page, text: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}
