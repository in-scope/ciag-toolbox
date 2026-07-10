import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BundleDraft } from "./bundle-writer";
import { createSaveBundleSessionStore } from "./chunked-save-bundle";
import type {
  SaveBundleDraftHeader,
  SaveBundleViewportHeaderEntry,
} from "../shared/chunked-save-bundle-protocol";

let spoolDir: string;

beforeAll(async () => {
  spoolDir = await mkdtemp(join(tmpdir(), "chunked-save-bundle-test-"));
});

afterAll(async () => {
  await rm(spoolDir, { recursive: true, force: true });
});

const RENDERING_STATE = {
  normalizationEnabled: false,
  selectedBandIndex: 0,
  lastAppliedOperationLabel: null,
};

function bakedEnviViewport(index: number, headerLength: number, binaryLength: number): SaveBundleViewportHeaderEntry {
  return {
    index,
    fileName: `cube-${index}.hdr`,
    asset: {
      kind: "baked",
      primary: { extension: "hdr", byteLength: headerLength },
      sidecar: { extension: "bin", byteLength: binaryLength },
    },
    renderingState: RENDERING_STATE,
    operationHistory: [],
  };
}

function externalViewport(index: number): SaveBundleViewportHeaderEntry {
  return {
    index,
    fileName: `photo-${index}.png`,
    asset: { kind: "external", absolutePath: `/abs/photo-${index}.png`, extension: "png" },
    renderingState: RENDERING_STATE,
    operationHistory: [],
  };
}

function headerOf(viewports: ReadonlyArray<SaveBundleViewportHeaderEntry>): SaveBundleDraftHeader {
  return { formatVersion: 2, gridLayout: "2x2", selectedViewportIndices: [0], viewports };
}

function bytesOfLength(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i + seed) % 251);
}

describe("createSaveBundleSessionStore", () => {
  it("spools chunked baked parts to files and returns a writable draft pointing at them", async () => {
    const store = createSaveBundleSessionStore(spoolDir);
    const headerBytes = bytesOfLength(10, 1);
    const binaryBytes = bytesOfLength(50, 7);
    const token = await store.begin(headerOf([bakedEnviViewport(0, 10, 50), externalViewport(1)]), "/out/bundle.ctbundle");
    await store.appendAssetChunk(token, 0, "primary", headerBytes);
    await store.appendAssetChunk(token, 0, "sidecar", binaryBytes.slice(0, 20));
    await store.appendAssetChunk(token, 0, "sidecar", binaryBytes.slice(20));
    const writable = await store.takeWritableBundleDraft(token);
    expect(writable.outputFilePath).toBe("/out/bundle.ctbundle");
    await expectWritableDraftMatchesUpload(writable.draft, headerBytes, binaryBytes);
    await store.release(token);
  });

  it("carries header metadata through to the writable draft unchanged", async () => {
    const store = createSaveBundleSessionStore(spoolDir);
    const viewport: SaveBundleViewportHeaderEntry = {
      ...bakedEnviViewport(3, 4, 4),
      colorInterpretation: "rgb",
      operationHistory: [
        {
          actionId: "invert",
          actionLabel: "Invert",
          appliedLabel: "Invert (all bands)",
          parameterValues: { allBands: true },
          timestampMs: 1_700_000_000_000,
        },
      ],
    };
    const token = await store.begin(headerOf([viewport]), "/out/meta.ctbundle");
    await store.appendAssetChunk(token, 3, "primary", bytesOfLength(4, 1));
    await store.appendAssetChunk(token, 3, "sidecar", bytesOfLength(4, 2));
    const writable = await store.takeWritableBundleDraft(token);
    expect(writable.draft.gridLayout).toBe("2x2");
    expect(writable.draft.selectedViewportIndices).toEqual([0]);
    expect(writable.draft.viewports[0]?.colorInterpretation).toBe("rgb");
    expect(writable.draft.viewports[0]?.operationHistory[0]?.actionId).toBe("invert");
    await store.release(token);
  });

  it("rejects finishing while a baked part is missing bytes", async () => {
    const store = createSaveBundleSessionStore(spoolDir);
    const token = await store.begin(headerOf([bakedEnviViewport(0, 10, 50)]), "/out/short.ctbundle");
    await store.appendAssetChunk(token, 0, "primary", bytesOfLength(10, 1));
    await expect(store.takeWritableBundleDraft(token)).rejects.toThrow(/did not match the described size/);
    await store.release(token);
  });

  it("rejects a chunk that would overflow the declared part size", async () => {
    const store = createSaveBundleSessionStore(spoolDir);
    const token = await store.begin(headerOf([bakedEnviViewport(0, 10, 50)]), "/out/overflow.ctbundle");
    await expect(store.appendAssetChunk(token, 0, "primary", bytesOfLength(11, 1))).rejects.toThrow(
      /did not match the described size/,
    );
    await store.release(token);
  });

  it("rejects chunks for unknown panels, parts, and tokens", async () => {
    const store = createSaveBundleSessionStore(spoolDir);
    const token = await store.begin(headerOf([externalViewport(0)]), "/out/unknown.ctbundle");
    await expect(store.appendAssetChunk(token, 0, "primary", bytesOfLength(1, 1))).rejects.toThrow(
      /unknown panel/,
    );
    await expect(store.appendAssetChunk("nope", 0, "primary", bytesOfLength(1, 1))).rejects.toThrow(
      /Unknown project save token/,
    );
    await store.release(token);
  });

  it("rejects appending after the draft was taken for writing", async () => {
    const store = createSaveBundleSessionStore(spoolDir);
    const token = await store.begin(headerOf([bakedEnviViewport(0, 4, 4)]), "/out/late.ctbundle");
    await store.appendAssetChunk(token, 0, "primary", bytesOfLength(4, 1));
    await store.appendAssetChunk(token, 0, "sidecar", bytesOfLength(4, 2));
    await store.takeWritableBundleDraft(token);
    await expect(store.appendAssetChunk(token, 0, "primary", bytesOfLength(1, 1))).rejects.toThrow(
      /already finished/,
    );
    await store.release(token);
  });

  it("rejects a header describing a non-positive packed size", async () => {
    const store = createSaveBundleSessionStore(spoolDir);
    await expect(store.begin(headerOf([bakedEnviViewport(0, 0, 4)]), "/out/bad.ctbundle")).rejects.toThrow(
      /invalid packed stack size/,
    );
  });

  it("release removes every spool file and tolerates unknown tokens", async () => {
    const store = createSaveBundleSessionStore(spoolDir);
    const token = await store.begin(headerOf([bakedEnviViewport(0, 4, 4)]), "/out/release.ctbundle");
    await store.appendAssetChunk(token, 0, "primary", bytesOfLength(4, 1));
    expect(await listSpoolFilesForToken(token)).toHaveLength(2);
    await store.release(token);
    expect(await listSpoolFilesForToken(token)).toHaveLength(0);
    await expect(store.release("nope")).resolves.toBeUndefined();
  });
});

async function expectWritableDraftMatchesUpload(
  draft: BundleDraft,
  headerBytes: Uint8Array,
  binaryBytes: Uint8Array,
): Promise<void> {
  const baked = draft.viewports[0]?.asset;
  expect(baked?.kind).toBe("baked");
  if (!baked || baked.kind !== "baked") return;
  expect(baked.primary.extension).toBe("hdr");
  expect(baked.sidecar?.extension).toBe("bin");
  expect(new Uint8Array(await readFile(baked.primary.absolutePath))).toEqual(headerBytes);
  expect(new Uint8Array(await readFile(baked.sidecar!.absolutePath))).toEqual(binaryBytes);
  expect(draft.viewports[1]?.asset.kind).toBe("external");
}

async function listSpoolFilesForToken(token: string): Promise<string[]> {
  const entries = await readdir(spoolDir);
  return entries.filter((name) => name.includes(token));
}
