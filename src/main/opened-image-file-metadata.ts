import { stat } from "node:fs/promises";
import { basename } from "node:path";

// Electron-free (unit-testable) stat-based metadata reader shared by the
// open-image dialogs and the bundle-asset resolver. Dialog and asset replies
// carry ONLY this metadata; file bytes always stream through the chunked
// opened-image read protocol (see src/main/CLAUDE.md).

export interface OpenedImageFileMetadataEntry {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  mtimeMs: number;
}

export async function readFileMetadataForOpenedImagePath(
  filePath: string,
): Promise<OpenedImageFileMetadataEntry> {
  const stats = await stat(filePath);
  return {
    fileName: basename(filePath),
    filePath,
    fileSizeBytes: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}
