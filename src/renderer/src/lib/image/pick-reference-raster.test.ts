// CT-234: the reference-raster pick obtains file bytes through the chunked
// opened-image read path (via readAndDecodeSingleOpenedImageFileOrThrow), never
// from the dialog reply - the dialog hands back metadata only, so a reference
// larger than 2 GiB works exactly like the main open path.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { pickAndRememberReferenceRasterFromDisk } from "@/lib/image/pick-reference-raster";
import {
  forgetAllReferenceRasters,
  readRememberedReferenceRasterOrNull,
} from "@/lib/image/reference-raster-store";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../../../../e2e/fixtures/multiband-12bit.tif", import.meta.url),
);

const FIXTURE_BYTES = readFileSync(FIXTURE_PATH);

const FIXTURE_FILE_PATH = "C:\\captures\\reference.tif";

function buildDialogMetadataEntry(): ToolboxOpenImagesDialogFileMetadataEntry {
  return {
    fileName: "reference.tif",
    filePath: FIXTURE_FILE_PATH,
    fileSizeBytes: FIXTURE_BYTES.byteLength,
    mtimeMs: 1000,
  };
}

function installFakeToolboxApiServing(bytesToServe: Uint8Array | null): void {
  vi.stubGlobal("window", {
    toolboxApi: {
      openImageDialog: async () =>
        bytesToServe === null
          ? { canceled: true }
          : { canceled: false, file: buildDialogMetadataEntry() },
      readOpenedImageFile: async (metadata: ToolboxOpenImagesDialogFileMetadataEntry) => ({
        fileName: metadata.fileName,
        filePath: metadata.filePath,
        bytes: bytesToServe,
        contentHash: "hash-reference",
        fileSizeBytes: metadata.fileSizeBytes,
        mtimeMs: metadata.mtimeMs,
      }),
    },
  });
}

describe("pick-reference-raster through the chunked open path (CT-234)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetAllReferenceRasters();
  });

  it("decodes the picked file from streamed bytes and remembers it under its path token", async () => {
    installFakeToolboxApiServing(new Uint8Array(FIXTURE_BYTES));
    const picked = await pickAndRememberReferenceRasterFromDisk();
    expect(picked).not.toBeNull();
    expect(picked?.token).toBe(FIXTURE_FILE_PATH);
    expect(picked?.fileName).toBe("reference.tif");
    expect(picked?.raster.bandCount).toBeGreaterThan(1);
    expect(readRememberedReferenceRasterOrNull(FIXTURE_FILE_PATH)).toBe(picked?.raster);
  });

  it("returns null without reading any file when the dialog is canceled", async () => {
    installFakeToolboxApiServing(null);
    await expect(pickAndRememberReferenceRasterFromDisk()).resolves.toBeNull();
    expect(readRememberedReferenceRasterOrNull(FIXTURE_FILE_PATH)).toBeNull();
  });

  it("throws the decode error and remembers nothing for an undecodable file", async () => {
    installFakeToolboxApiServing(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    await expect(pickAndRememberReferenceRasterFromDisk()).rejects.toThrow();
    expect(readRememberedReferenceRasterOrNull(FIXTURE_FILE_PATH)).toBeNull();
  });
});
