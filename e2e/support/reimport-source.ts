import { expect } from "@playwright/test";
import { basename } from "node:path";
import type { Page } from "@playwright/test";

import { enqueueOpenDialogPaths } from "./dialog-stub-controls";
import { openPanelContextMenu } from "./duplicate-panel";
import { runAsStoryboardStep } from "./storyboard-step";

// CT-234: the panel context menu's "Re-import source from disk" replaces the
// panel's content with a freshly picked file. The dialog reply is metadata
// only; the file bytes stream through the chunked opened-image read protocol,
// so this flow works at any size the 16 GiB openable limit allows.

export async function reimportPanelSourceFromDisk(
  page: Page,
  panelNumber: number,
  absoluteFilePath: string,
): Promise<void> {
  const fileName = basename(absoluteFilePath);
  await runAsStoryboardStep(page, `Re-import panel ${panelNumber} from ${fileName}`, async () => {
    await enqueueOpenDialogPaths(page, [absoluteFilePath]);
    await openPanelContextMenu(page, panelNumber);
    await page.getByRole("menuitem", { name: "Re-import source from disk" }).click();
    await expect(reimportSuccessToast(page, fileName)).toBeVisible();
  });
}

export function reimportSuccessToast(page: Page, fileName: string) {
  return page.locator("[data-sonner-toast]").filter({ hasText: `Re-imported ${fileName}` });
}
