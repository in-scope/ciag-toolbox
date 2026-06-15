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

function saveImageFormatOption(page: Page, formatLabel: string): Locator {
  return saveImageFormatRadioGroup(page).getByRole("radio", { name: formatLabel, exact: true });
}

// A format that cannot apply to the selected source is disabled in the picker and carries
// a shadcn tooltip naming the reason. Hovering the option's label (the tooltip trigger,
// since a disabled input swallows pointer events) reveals the role="tooltip" content.
export async function expectSaveImageFormatOptionDisabledWithTooltip(
  page: Page,
  formatLabel: string,
  reasonSubstring: string,
): Promise<void> {
  const option = saveImageFormatOption(page, formatLabel);
  await expect(option).toBeDisabled();
  await option.locator("xpath=ancestor::label[1]").hover();
  await expect(page.getByRole("tooltip").filter({ hasText: reasonSubstring })).toBeVisible();
}

function saveImageFormatOptionLabel(page: Page, formatLabel: string): Locator {
  return saveImageFormatOption(page, formatLabel).locator("xpath=ancestor::label[1]");
}

// A multi-band stack loses bands silently when saved to a single-band format, so the picker
// discloses what each option saves via a per-option tooltip ("current band only" / "all N
// bands"). The option stays enabled and selectable; this is disclosure, not a block. Every
// single-band option carries the SAME note text, so the assertion follows the hovered
// trigger's own aria-describedby rather than matching the shared text (which the pointer can
// leave open on several options at once while crossing the list).
export async function expectSaveImageFormatOptionDisclosesNote(
  page: Page,
  formatLabel: string,
  noteSubstring: string,
): Promise<void> {
  await expect(saveImageFormatOption(page, formatLabel)).toBeEnabled();
  const tooltip = await revealOptionTooltipForHoveredLabel(page, formatLabel);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(noteSubstring);
}

async function revealOptionTooltipForHoveredLabel(page: Page, formatLabel: string): Promise<Locator> {
  const label = saveImageFormatOptionLabel(page, formatLabel);
  await label.hover();
  await expect(label).toHaveAttribute("aria-describedby", /.+/);
  const tooltipId = await label.getAttribute("aria-describedby");
  return page.locator(`[id="${tooltipId}"]`);
}

// Single-band stacks and photo sources lose no bands, so their options carry no band-coverage
// tooltip at all (an unwrapped <label> never becomes a Radix tooltip trigger).
export async function expectSaveImageFormatOptionHasNoBandDisclosure(
  page: Page,
  formatLabel: string,
): Promise<void> {
  await expect(saveImageFormatOptionLabel(page, formatLabel)).not.toHaveAttribute(
    "data-state",
    /.*/,
  );
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
