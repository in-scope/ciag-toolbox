import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { openSubsetBandsEditor, subsetBandsEditor } from "./band-management";
import { subsetBandsModeSelect } from "./band-selection";
import { runAsStoryboardStep } from "./storyboard-step";

// CT-301: the Subset Bands editor's "Duplicate" mode appends copies of the
// typed bands to the end of the stack. It reuses the same editor shell (mode
// select, "Result" segmented control, Apply/Cancel) as "Keep bands" and
// "By function".

export const DUPLICATE_BANDS_OPERATION_LABEL = "Duplicate Bands";
export const SUBSET_BANDS_DUPLICATE_MODE_VALUE = "duplicate";

export function subsetBandsDuplicateField(page: Page): Locator {
  return subsetBandsEditor(page).getByRole("textbox", { name: "Bands to duplicate" });
}

export async function openSubsetBandsDuplicateEditor(page: Page): Promise<Locator> {
  return runAsStoryboardStep(page, "Open Subset Bands in its Duplicate mode", async () => {
    const editor = await openSubsetBandsEditor(page);
    await subsetBandsModeSelect(page).selectOption(SUBSET_BANDS_DUPLICATE_MODE_VALUE);
    await expect(subsetBandsDuplicateField(page)).toBeVisible();
    return editor;
  });
}

export async function typeSubsetBandsDuplicateRange(page: Page, text: string): Promise<void> {
  await subsetBandsDuplicateField(page).fill(text);
}
