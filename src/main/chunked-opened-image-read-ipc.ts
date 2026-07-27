import { ipcMain } from "electron";

import { createChunkedOpenedImageFileReader } from "./chunked-opened-image-read";
import {
  OPENED_IMAGE_READ_ABORT_CHANNEL,
  OPENED_IMAGE_READ_BEGIN_CHANNEL,
  OPENED_IMAGE_READ_CHUNK_CHANNEL,
  OPENED_IMAGE_READ_FINISH_CHANNEL,
  type ChunkedOpenedImageReadBeginRequest,
  type ChunkedOpenedImageReadChunkRequest,
  type ChunkedOpenedImageReadFinishRequest,
} from "../shared/chunked-opened-image-read-protocol";

export function registerChunkedOpenedImageReadIpcHandlers(): void {
  const reader = createChunkedOpenedImageFileReader();
  ipcMain.handle(
    OPENED_IMAGE_READ_BEGIN_CHANNEL,
    (_event, request: ChunkedOpenedImageReadBeginRequest) => reader.begin(request.filePath),
  );
  ipcMain.handle(
    OPENED_IMAGE_READ_CHUNK_CHANNEL,
    (_event, request: ChunkedOpenedImageReadChunkRequest) =>
      reader.readNextChunk(request.token, request.target),
  );
  ipcMain.handle(
    OPENED_IMAGE_READ_FINISH_CHANNEL,
    (_event, request: ChunkedOpenedImageReadFinishRequest) => reader.finish(request.token),
  );
  ipcMain.handle(
    OPENED_IMAGE_READ_ABORT_CHANNEL,
    (_event, request: ChunkedOpenedImageReadFinishRequest) => reader.abort(request.token),
  );
}
