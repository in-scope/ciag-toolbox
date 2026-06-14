import { dialog, ipcMain, type BrowserWindow } from "electron";

// Keep this literal in sync with the matching constant in src/preload/index.ts.
export const E2E_TEST_MODE_PRELOAD_ARGUMENT = "--msi-e2e-test-mode";

const ENQUEUE_OPEN_DIALOG_PATHS_CHANNEL = "test:enqueue-open-dialog-paths";
const ENQUEUE_SAVE_DIALOG_PATH_CHANNEL = "test:enqueue-save-dialog-path";
const RESET_DIALOG_QUEUES_CHANNEL = "test:reset-dialog-queues";

const queuedOpenDialogSelections: string[][] = [];
const queuedSaveDialogPaths: string[] = [];

export function isE2eTestModeEnabled(): boolean {
  return process.env["MSI_E2E"] === "1";
}

function enqueueOpenDialogSelection(filePaths: ReadonlyArray<string>): void {
  queuedOpenDialogSelections.push([...filePaths]);
}

function enqueueSaveDialogPath(filePath: string): void {
  queuedSaveDialogPaths.push(filePath);
}

function clearQueuedDialogPaths(): void {
  queuedOpenDialogSelections.length = 0;
  queuedSaveDialogPaths.length = 0;
}

function dequeueStubbedOpenDialogResult(): Electron.OpenDialogReturnValue {
  const selection = queuedOpenDialogSelections.shift();
  if (selection === undefined) return { canceled: true, filePaths: [] };
  return { canceled: false, filePaths: selection };
}

function dequeueStubbedSaveDialogResult(): Electron.SaveDialogReturnValue {
  const filePath = queuedSaveDialogPaths.shift();
  if (filePath === undefined) return { canceled: true, filePath: "" };
  return { canceled: false, filePath };
}

export async function showOpenDialogOrStub(
  window: BrowserWindow,
  options: Electron.OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  if (isE2eTestModeEnabled()) return dequeueStubbedOpenDialogResult();
  return dialog.showOpenDialog(window, options);
}

export async function showSaveDialogOrStub(
  window: BrowserWindow,
  options: Electron.SaveDialogOptions,
): Promise<Electron.SaveDialogReturnValue> {
  if (isE2eTestModeEnabled()) return dequeueStubbedSaveDialogResult();
  return dialog.showSaveDialog(window, options);
}

function registerEnqueueOpenDialogPathsTestChannel(): void {
  ipcMain.handle(
    ENQUEUE_OPEN_DIALOG_PATHS_CHANNEL,
    (_event, filePaths: ReadonlyArray<string>) => enqueueOpenDialogSelection(filePaths),
  );
}

function registerEnqueueSaveDialogPathTestChannel(): void {
  ipcMain.handle(
    ENQUEUE_SAVE_DIALOG_PATH_CHANNEL,
    (_event, filePath: string) => enqueueSaveDialogPath(filePath),
  );
}

function registerResetDialogQueuesTestChannel(): void {
  ipcMain.handle(RESET_DIALOG_QUEUES_CHANNEL, () => clearQueuedDialogPaths());
}

export function registerE2eDialogStubTestChannelsWhenEnabled(): void {
  if (!isE2eTestModeEnabled()) return;
  registerEnqueueOpenDialogPathsTestChannel();
  registerEnqueueSaveDialogPathTestChannel();
  registerResetDialogQueuesTestChannel();
}
