import { BrowserWindow, ipcMain } from "electron";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import { showOpenDialogOrStub } from "./e2e-dialog-stub";
import {
  readFileMetadataForOpenedImagePath,
  type OpenedImageFileMetadataEntry,
} from "./opened-image-file-metadata";

// CT-303: picks the mask files to import. The reply is METADATA ONLY (the
// CT-234 rule): every picked file's bytes stream to the renderer through the
// chunked opened-image read protocol like any other picked file. The JSON
// sidecar is the one thing that travels here, because it is a handful of
// category names and colours and the renderer cannot read the disk itself.
//
// CT-328: the pick is a MULTI-selection of PNGs and zips, replied to in pick
// order, because a person's per-class masks are several files and the toolbox's
// own export is one zip. A zip has no sidecar beside it (its sidecar is inside
// it), so only a PNG's neighbour is looked up.

export interface PickedMaskFileDescription {
  file: OpenedImageFileMetadataEntry;
  sidecarText: string | null;
}

export type MaskImportDialogResult =
  | { canceled: true }
  | { canceled: false; files: ReadonlyArray<PickedMaskFileDescription> };

const MASK_IMPORT_DIALOG_CHANNEL = "mask:import-dialog";

const MASK_SIDECAR_EXTENSION = "json";
const MASK_ZIP_EXTENSION = ".zip";

// A sidecar is a few hundred bytes of labelling; anything larger is not one,
// and the import falls back to default category names and colours.
const MAX_MASK_SIDECAR_BYTES = 1024 * 1024;

const MASK_FILE_FILTER: Electron.FileFilter = {
  name: "Mask files",
  extensions: ["png", "zip"],
};

async function chooseMaskFilesAndReadSidecars(
  window: BrowserWindow,
): Promise<MaskImportDialogResult> {
  const dialogResult = await showOpenDialogOrStub(window, {
    title: "Import Mask",
    properties: ["openFile", "multiSelections"],
    filters: [MASK_FILE_FILTER],
  });
  if (dialogResult.canceled || dialogResult.filePaths.length === 0) return { canceled: true };
  return {
    canceled: false,
    files: await Promise.all(dialogResult.filePaths.map(describePickedMaskFile)),
  };
}

async function describePickedMaskFile(pickedPath: string): Promise<PickedMaskFileDescription> {
  return {
    file: await readFileMetadataForOpenedImagePath(pickedPath),
    sidecarText: await readSidecarTextBesidePickedMaskOrNull(pickedPath),
  };
}

async function readSidecarTextBesidePickedMaskOrNull(
  pickedPath: string,
): Promise<string | null> {
  if (pickedPath.toLowerCase().endsWith(MASK_ZIP_EXTENSION)) return null;
  return readMaskSidecarTextOrNull(buildSidecarPathFor(pickedPath));
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
  return chooseMaskFilesAndReadSidecars(window);
}

export function registerMaskImportDialogIpcHandler(): void {
  ipcMain.handle(MASK_IMPORT_DIALOG_CHANNEL, handleMaskImportDialogIpc);
}
