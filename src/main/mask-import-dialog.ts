import { BrowserWindow, ipcMain } from "electron";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import { showOpenDialogOrStub } from "./e2e-dialog-stub";
import {
  readFileMetadataForOpenedImagePath,
  type OpenedImageFileMetadataEntry,
} from "./opened-image-file-metadata";

// CT-303: picks a mask PNG to import. The reply is METADATA ONLY (the CT-234
// rule): the PNG's bytes stream to the renderer through the chunked
// opened-image read protocol like any other picked file. The JSON sidecar is
// the one thing that travels here, because it is a handful of category names
// and colours and the renderer cannot read the disk itself.

export type MaskImportDialogResult =
  | { canceled: true }
  | {
      canceled: false;
      file: OpenedImageFileMetadataEntry;
      sidecarText: string | null;
    };

const MASK_IMPORT_DIALOG_CHANNEL = "mask:import-dialog";

const MASK_SIDECAR_EXTENSION = "json";

// A sidecar is a few hundred bytes of labelling; anything larger is not one,
// and the import falls back to default category names and colours.
const MAX_MASK_SIDECAR_BYTES = 1024 * 1024;

const MASK_PNG_FILTER: Electron.FileFilter = { name: "Mask PNG", extensions: ["png"] };

async function chooseMaskFileAndReadSidecar(
  window: BrowserWindow,
): Promise<MaskImportDialogResult> {
  const dialogResult = await showOpenDialogOrStub(window, {
    title: "Import Mask",
    properties: ["openFile"],
    filters: [MASK_PNG_FILTER],
  });
  const [pickedPath] = dialogResult.filePaths;
  if (dialogResult.canceled || pickedPath === undefined) return { canceled: true };
  return describePickedMaskFile(pickedPath);
}

async function describePickedMaskFile(pickedPath: string): Promise<MaskImportDialogResult> {
  return {
    canceled: false,
    file: await readFileMetadataForOpenedImagePath(pickedPath),
    sidecarText: await readMaskSidecarTextOrNull(buildSidecarPathFor(pickedPath)),
  };
}

function buildSidecarPathFor(maskFilePath: string): string {
  const extension = extname(maskFilePath);
  const stem = maskFilePath.slice(0, maskFilePath.length - extension.length);
  return `${stem}.${MASK_SIDECAR_EXTENSION}`;
}

async function readMaskSidecarTextOrNull(sidecarPath: string): Promise<string | null> {
  try {
    const stats = await stat(sidecarPath);
    if (stats.size > MAX_MASK_SIDECAR_BYTES) return null;
    return await readFile(sidecarPath, "utf8");
  } catch {
    return null;
  }
}

async function handleMaskImportDialogIpc(
  event: Electron.IpcMainInvokeEvent,
): Promise<MaskImportDialogResult> {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return { canceled: true };
  return chooseMaskFileAndReadSidecar(window);
}

export function registerMaskImportDialogIpcHandler(): void {
  ipcMain.handle(MASK_IMPORT_DIALOG_CHANNEL, handleMaskImportDialogIpc);
}
