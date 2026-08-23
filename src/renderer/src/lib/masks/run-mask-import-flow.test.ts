import { describe, expect, it, vi } from "vitest";

import { encodeMaskValuesAsGrayscalePngBytes } from "@/lib/masks/mask-png-encode";
import {
  importMaskLayerThroughOpenDialog,
  type MaskImportFlowApi,
} from "@/lib/masks/run-mask-import-flow";

// CT-303: the import picks the PNG through main (metadata plus the optional
// sidecar text), streams the file bytes through the chunked opened-image read,
// and refuses a mask that does not cover the active stack.

const STACK = { width: 4, height: 2 };

const SIDECAR_TEXT = JSON.stringify({
  formatVersion: 1,
  name: "Parchment mask",
  width: 4,
  height: 2,
  categories: [
    { index: 1, name: "Parchment", color: "#111111" },
    { index: 2, name: "Substrate", color: "#222222" },
  ],
  opacity: 60,
});

async function createFakeImportApi(options: {
  width?: number;
  height?: number;
  values?: ReadonlyArray<number>;
  sidecarText?: string | null;
  canceled?: boolean;
}): Promise<MaskImportFlowApi> {
  const width = options.width ?? 4;
  const height = options.height ?? 2;
  const values = Uint8Array.from(options.values ?? [0, 1, 1, 0, 2, 2, 0, 0]);
  const bytes = await encodeMaskValuesAsGrayscalePngBytes(width, height, values);
  return {
    importMaskDialog: vi.fn(async () =>
      options.canceled
        ? ({ canceled: true } as const)
        : ({
            canceled: false,
            file: {
              fileName: "mask-multiband.png",
              filePath: "C:/masks/mask-multiband.png",
              fileSizeBytes: bytes.byteLength,
              mtimeMs: 0,
            },
            sidecarText: options.sidecarText ?? null,
          } as const),
    ),
    readOpenedImageFile: vi.fn(async (metadata) => ({
      ...metadata,
      contentHash: "hash",
      bytes,
    })),
  };
}

describe("importMaskLayerThroughOpenDialog", () => {
  it("builds a layer from the picked PNG and its sidecar", async () => {
    const api = await createFakeImportApi({ sidecarText: SIDECAR_TEXT });
    const result = await importMaskLayerThroughOpenDialog(STACK, api);

    expect(result.canceled).toBe(false);
    if (result.canceled) return;
    expect(result.content.name).toBe("Parchment mask");
    expect(result.content.opacityPercent).toBe(60);
    expect(Array.from(result.content.values)).toEqual([0, 1, 1, 0, 2, 2, 0, 0]);
    expect(result.content.categories.map((category) => category.name)).toEqual([
      "Parchment",
      "Substrate",
    ]);
  });

  it("falls back to default category names when no sidecar sits beside the PNG", async () => {
    const api = await createFakeImportApi({ sidecarText: null });
    const result = await importMaskLayerThroughOpenDialog(STACK, api);

    expect(result.canceled).toBe(false);
    if (result.canceled) return;
    expect(result.content.name).toBe("mask-multiband");
    expect(result.content.categories.map((category) => category.name)).toEqual([
      "Foreground",
      "Background",
    ]);
  });

  it("reports a cancelled dialog without reading any file", async () => {
    const api = await createFakeImportApi({ canceled: true });
    expect(await importMaskLayerThroughOpenDialog(STACK, api)).toEqual({ canceled: true });
    expect(api.readOpenedImageFile).not.toHaveBeenCalled();
  });

  it("refuses a mask whose grid does not match the stack", async () => {
    const api = await createFakeImportApi({ width: 8, height: 8, values: new Array(64).fill(0) });
    await expect(importMaskLayerThroughOpenDialog(STACK, api)).rejects.toThrow(
      "This mask is 8 x 8 but the stack is 4 x 2. Import a mask that matches the stack's size.",
    );
  });

  it("refuses a mask holding more than five categories", async () => {
    const api = await createFakeImportApi({ values: [0, 1, 2, 3, 4, 5, 6, 0] });
    await expect(importMaskLayerThroughOpenDialog(STACK, api)).rejects.toThrow(
      "A mask layer holds at most 5 categories",
    );
  });
});
