import { ipcMain } from "electron";

import { createChunkedPng16DecodeSessions } from "./chunked-png16-decode";
import {
  PNG16_DECODE_ABORT_CHANNEL,
  PNG16_DECODE_BEGIN_CHANNEL,
  PNG16_DECODE_CHUNK_CHANNEL,
  PNG16_DECODE_FINISH_CHANNEL,
  type ChunkedPng16DecodeAbortRequest,
  type ChunkedPng16DecodeBeginRequest,
  type ChunkedPng16DecodeChunkRequest,
  type ChunkedPng16DecodeFinishRequest,
} from "../shared/chunked-png16-decode-protocol";

export function registerChunkedPng16DecodeIpcHandlers(): void {
  const sessions = createChunkedPng16DecodeSessions();
  ipcMain.handle(
    PNG16_DECODE_BEGIN_CHANNEL,
    (_event, request: ChunkedPng16DecodeBeginRequest) => sessions.begin(request.filePath),
  );
  ipcMain.handle(
    PNG16_DECODE_CHUNK_CHANNEL,
    (_event, request: ChunkedPng16DecodeChunkRequest) =>
      sessions.readNextDecodedChunk(request.token),
  );
  ipcMain.handle(
    PNG16_DECODE_FINISH_CHANNEL,
    (_event, request: ChunkedPng16DecodeFinishRequest) => sessions.finish(request.token),
  );
  ipcMain.handle(
    PNG16_DECODE_ABORT_CHANNEL,
    (_event, request: ChunkedPng16DecodeAbortRequest) => sessions.abort(request.token),
  );
}
