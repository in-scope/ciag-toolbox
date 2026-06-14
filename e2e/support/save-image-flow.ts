import { expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ElectronApplication, Locator, Page } from "@playwright/test";

import { enqueueOpenDialogPaths, enqueueSaveDialogPath } from "./dialog-stub-controls";
import { triggerSaveImageMenuItem } from "./main-process";
import { applicationToolbar } from "./operations";

// The Save Image flow has two stages. First the native File > "Save Image..." menu item
// (driven from the MAIN process, since Playwright cannot click native menus) opens the
// shadcn "Save image as" format/bit-depth picker. Choosing a format and clicking "Save..."
// then routes through the CT-113 save-dialog stub, which writes the encoded bytes (plus an
// ENVI ".bin" sidecar) to the test-controlled destination path; a success toast names it.

export function saveImageFormatPicker(page: Page): Locator {
  return page.getByRole("dialog", { name: "Save image as" });
}

export function saveImageFormatRadioGroup(page: Page): Locator {
  return saveImageFormatPicker(page).getByRole("radiogroup", { name: "Save format" });
}

export async function readOfferedSaveImageFormatLabels(page: Page): Promise<string[]> {
  const radios = saveImageFormatRadioGroup(page).getByRole("radio");
  return radios.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("aria-label") ?? ""),
  );
}

export async function chooseSaveImageFormat(page: Page, formatLabel: string): Promise<void> {
  await saveImageFormatRadioGroup(page).getByRole("radio", { name: formatLabel, exact: true }).check();
}

export async function confirmSaveImageFormat(page: Page): Promise<void> {
  await saveImageFormatPicker(page).getByRole("button", { name: "Save...", exact: true }).click();
}

export async function cancelSaveImageFormatPicker(page: Page): Promise<void> {
  await saveImageFormatPicker(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(saveImageFormatPicker(page)).toBeHidden();
}

export interface SaveImageExportRequest {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly formatLabel: string;
  readonly destinationPath: string;
}

export async function exportSelectedStackThroughSaveDialog(
  request: SaveImageExportRequest,
): Promise<void> {
  await enqueueSaveDialogPath(request.page, request.destinationPath);
  await triggerSaveImageMenuItem(request.app);
  await expect(saveImageFormatPicker(request.page)).toBeVisible();
  await chooseSaveImageFormat(request.page, request.formatLabel);
  await confirmSaveImageFormat(request.page);
  await expectSaveSucceededToast(request.page);
}

async function expectSaveSucceededToast(page: Page): Promise<void> {
  await expect(page.getByText("Saved to", { exact: false }).first()).toBeVisible();
}

export async function loadImageFromAbsolutePath(page: Page, absolutePath: string): Promise<void> {
  await enqueueOpenDialogPaths(page, [absolutePath]);
  await applicationToolbar(page).getByRole("button", { name: "Open image" }).click();
  await expect(page.getByText(basename(absolutePath), { exact: false }).first()).toBeVisible();
}

export async function createTemporaryExportDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "msi-e2e-export-"));
}
