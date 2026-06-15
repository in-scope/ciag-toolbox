import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { enqueueOpenDialogPaths } from "./dialog-stub-controls";
import { applicationToolbar } from "./operations";

// The unified Open Images flow (CT-055, manual section 7): the toolbar "Open image"
// control and the File menu both route here. A selection of one path takes the
// fast path (no modal); a selection of two or more opens the "Review stacks" modal;
// opening into a full max-size grid raises the replace-target picker.

export async function enqueueAndTriggerOpenImages(
  page: Page,
  filePaths: ReadonlyArray<string>,
): Promise<void> {
  await enqueueOpenDialogPaths(page, filePaths);
  await applicationToolbar(page).getByRole("button", { name: "Open image" }).click();
}

export function openImagesReviewModal(page: Page): Locator {
  return page.getByRole("dialog", { name: "Review stacks" });
}

export function openImagesReplaceTargetPicker(page: Page): Locator {
  return page.getByRole("dialog", { name: "Replace which panel?" });
}

export function reviewModalRows(page: Page): Locator {
  return openImagesReviewModal(page).getByRole("listitem");
}

export function reviewModalNewStackButton(page: Page): Locator {
  return openImagesReviewModal(page).getByRole("button", { name: "New stack" });
}

export function reviewModalGroupModeSelect(page: Page): Locator {
  return openImagesReviewModal(page).getByRole("combobox", { name: "Group mode" });
}

export async function readReviewModalGroupModeOptionLabels(page: Page): Promise<string[]> {
  return reviewModalGroupModeSelect(page)
    .locator("option")
    .evaluateAll((options) => options.map((option) => (option.textContent ?? "").trim()));
}

export async function readReviewModalRowFileNamesInOrder(page: Page): Promise<string[]> {
  const ariaLabels = await reviewModalRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("aria-label") ?? ""),
  );
  return ariaLabels.map(extractFileNameFromRowAriaLabel);
}

function extractFileNameFromRowAriaLabel(ariaLabel: string): string {
  const separatorIndex = ariaLabel.indexOf(": ");
  return separatorIndex < 0 ? ariaLabel : ariaLabel.slice(separatorIndex + 2);
}

export async function confirmReviewModal(page: Page): Promise<void> {
  const modal = openImagesReviewModal(page);
  await modal.getByRole("button", { name: /^Open \d+ stack/ }).click();
  await expect(modal).toBeHidden();
}

export async function cancelReplaceTargetPicker(page: Page): Promise<void> {
  const picker = openImagesReplaceTargetPicker(page);
  await picker.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(picker).toBeHidden();
}

export function openImagesErrorToast(page: Page): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: /Could not open/ });
}
