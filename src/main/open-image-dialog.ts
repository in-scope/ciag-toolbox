import { BrowserWindow, ipcMain } from "electron";

import { showOpenDialogOrStub } from "./e2e-dialog-stub";
import {
  readFileMetadataForOpenedImagePath,
  type OpenedImageFileMetadataEntry,
} from "./open-images-dialog";

// CT-234: this dialog reply carries METADATA ONLY. File bytes never cross this
// channel; the renderer reads them through the chunked opened-image protocol
// (chunked-opened-image-read-ipc.ts), which also enforces the 16 GiB openable
// limit, resolves ENVI binary siblings, and computes the content hash.
export type OpenImageResult =
  | { canceled: true }
  | { canceled: false; file: OpenedImageFileMetadataEntry };

const OPEN_IMAGE_DIALOG_CHANNEL = "image:open-dialog";

const SUPPORTED_IMAGE_FILTER: Electron.FileFilter = {
  name: "Images",
  extensions: [
    "png",
    "jpg",
    "jpeg",
    "tif",
    "tiff",
    "hdr",
    "dng",
    "cr3",
    "arw",
    "nef",
    "raf",
    "orf",
    "pef",
    "rw2",
  ],
};

async function showImageOpenDialog(
  window: BrowserWindow,
): Promise<Electron.OpenDialogReturnValue> {
  return showOpenDialogOrStub(window, {
    title: "Open Image",
    properties: ["openFile"],
    filters: [SUPPORTED_IMAGE_FILTER],
  });
}

async function chooseImageAndCollectMetadata(
  window: BrowserWindow,
): Promise<OpenImageResult> {
  const dialogResult = await showImageOpenDialog(window);
  const [firstPath] = dialogResult.filePaths;
  if (dialogResult.canceled || firstPath === undefined) {
    return { canceled: true };
  }
  return { canceled: false, file: await readFileMetadataForOpenedImagePath(firstPath) };
}

function findWindowForIpcEvent(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function handleOpenImageDialogIpc(
  event: Electron.IpcMainInvokeEvent,
): Promise<OpenImageResult> {
  const window = findWindowForIpcEvent(event);
  if (!window) return { canceled: true };
  return chooseImageAndCollectMetadata(window);
}

export function registerOpenImageDialogIpcHandler(): void {
  ipcMain.handle(OPEN_IMAGE_DIALOG_CHANNEL, handleOpenImageDialogIpc);
}
