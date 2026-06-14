import { expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";

import { enqueueOpenDialogPaths, enqueueSaveDialogPath } from "./dialog-stub-controls";
import { triggerOpenProjectMenuItem, triggerSaveProjectMenuItem } from "./main-process";

// The project bundle round-trip reuses the CT-113 dialog stub. "Save Project" is a native
// File-menu item (driven from the MAIN process), and on a fresh launch with no current
// bundle path it routes the Save-As save dialog through the stub, which writes the .ctbundle
// to the test-controlled path; a "Saved project to <path>" toast confirms it. "Open Project..."
// routes the open dialog through the stub and a "Opened project (N viewports)" toast confirms.

export interface SaveProjectBundleRequest {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly destinationPath: string;
}

export async function saveProjectBundleThroughSaveDialog(
  request: SaveProjectBundleRequest,
): Promise<void> {
  await enqueueSaveDialogPath(request.page, request.destinationPath);
  await triggerSaveProjectMenuItem(request.app);
  await expectProjectSavedToast(request.page);
}

async function expectProjectSavedToast(page: Page): Promise<void> {
  await expect(page.getByText("Saved project to", { exact: false }).first()).toBeVisible();
}

export interface OpenProjectBundleRequest {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly bundlePath: string;
}

export async function openProjectBundleThroughOpenDialog(
  request: OpenProjectBundleRequest,
): Promise<void> {
  await enqueueOpenDialogPaths(request.page, [request.bundlePath]);
  await triggerOpenProjectMenuItem(request.app);
  await expectProjectOpenedToast(request.page);
}

async function expectProjectOpenedToast(page: Page): Promise<void> {
  await expect(page.getByText("Opened project", { exact: false }).first()).toBeVisible();
}

export async function createTemporaryProjectBundleDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "msi-e2e-project-"));
}
