import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { enqueueOpenDialogPaths } from "./dialog-stub-controls";
import { applicationToolbar } from "./operations";
import { runAsStoryboardStep } from "./storyboard-step";

// The unified Open Images flow (CT-055, manual section 7): the toolbar "Open image"
// control and the File menu both route here. A selection of one path takes the
// fast path (no modal); a selection of two or more opens the "Review stacks" modal;
// opening into a full max-size grid raises the replace-target picker.

export async function enqueueAndTriggerOpenImages(
  page: Page,
  filePaths: ReadonlyArray<string>,
): Promise<void> {
  await runAsStoryboardStep(
    page,
    `Trigger Open image with ${filePaths.length} selected ${filePaths.length === 1 ? "file" : "files"}`,
    async () => {
      await enqueueOpenDialogPaths(page, filePaths);
      await applicationToolbar(page).getByRole("button", { name: "Open image" }).click();
    },
  );
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

export function reviewModalGroups(page: Page): Locator {
  return openImagesReviewModal(page).getByRole("region");
}

export function reviewModalGroupModeSelect(page: Page): Locator {
  return openImagesReviewModal(page).getByRole("combobox", { name: "Group mode" });
}

export async function chooseReviewModalGroupMode(
  page: Page,
  optionLabel: "Combine into one stack" | "Open bands separately",
): Promise<void> {
  await runAsStoryboardStep(page, `Switch the group mode to "${optionLabel}"`, async () => {
    await reviewModalGroupModeSelect(page).selectOption({ label: optionLabel });
  });
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
  await runAsStoryboardStep(page, "Confirm the Review stacks modal to open the stacks", async () => {
    const modal = openImagesReviewModal(page);
    await modal.getByRole("button", { name: /^Open \d+ stack/ }).click();
    await expect(modal).toBeHidden();
  });
}

export async function cancelReplaceTargetPicker(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Cancel the replace-panel picker", async () => {
    const picker = openImagesReplaceTargetPicker(page);
    await picker.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(picker).toBeHidden();
  });
}

export function openImagesErrorToast(page: Page): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: /Could not open/ });
}
