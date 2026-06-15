import type { Page } from "@playwright/test";

interface ToolboxE2eBridge {
  enqueueOpenDialogPaths: (filePaths: ReadonlyArray<string>) => Promise<void>;
  enqueueSaveDialogPath: (filePath: string) => Promise<void>;
  resetDialogQueues: () => Promise<void>;
}

declare global {
  interface Window {
    toolboxE2E: ToolboxE2eBridge;
  }
}

export async function enqueueOpenDialogPaths(
  page: Page,
  filePaths: ReadonlyArray<string>,
): Promise<void> {
  await page.evaluate(
    (paths) => window.toolboxE2E.enqueueOpenDialogPaths(paths),
    filePaths,
  );
}

export async function enqueueSaveDialogPath(page: Page, filePath: string): Promise<void> {
  await page.evaluate((path) => window.toolboxE2E.enqueueSaveDialogPath(path), filePath);
}

export async function resetDialogQueues(page: Page): Promise<void> {
  await page.evaluate(() => window.toolboxE2E.resetDialogQueues());
}
