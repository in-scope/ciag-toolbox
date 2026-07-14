// CT-232: once decode completes, the open flow must not retain the raw file
// bytes anywhere - the grouping proposal and single-file results may reference
// only decoded band arrays, never the input byte arrays or their buffers, so
// steady-state memory after an open is one cube instead of cube plus file.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readAndDecodeSingleOpenedImageFile,
  readAndDecodeSingleOpenedImageFileOrThrow,
  runOpenImagesDialogPhase,
} from "@/lib/image/run-open-images-flow";
import type { BusyEntryHandle } from "@/state/busy-state-context";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../../../../e2e/fixtures/multiband-12bit.tif", import.meta.url),
);

const FIXTURE_BYTES = readFileSync(FIXTURE_PATH);

function buildFixtureMetadataEntry(fileName: string): ToolboxOpenImagesDialogFileMetadataEntry {
  return {
    fileName,
    filePath: `C:\\captures\\${fileName}`,
    fileSizeBytes: FIXTURE_BYTES.byteLength,
    mtimeMs: 1000,
  };
}

interface FakeToolboxApiRecord {
  readonly handedOutByteArrays: Uint8Array[];
}

function installFakeToolboxApiServingFixtureBytes(
  files: ReadonlyArray<ToolboxOpenImagesDialogFileMetadataEntry>,
): FakeToolboxApiRecord {
  const handedOutByteArrays: Uint8Array[] = [];
  vi.stubGlobal("window", {
    toolboxApi: {
      openImagesDialog: async () => ({ canceled: false, files }),
      readOpenedImageFile: async (metadata: ToolboxOpenImagesDialogFileMetadataEntry) =>
        buildOpenedFileEntryTrackingBytes(metadata, handedOutByteArrays),
    },
  });
  return { handedOutByteArrays };
}

function buildOpenedFileEntryTrackingBytes(
  metadata: ToolboxOpenImagesDialogFileMetadataEntry,
  handedOutByteArrays: Uint8Array[],
): ToolboxOpenedImagesFileEntry {
  const bytes = new Uint8Array(FIXTURE_BYTES);
  handedOutByteArrays.push(bytes);
  return {
    fileName: metadata.fileName,
    filePath: metadata.filePath,
    bytes,
    contentHash: `hash-${metadata.fileName}`,
    fileSizeBytes: metadata.fileSizeBytes,
    mtimeMs: metadata.mtimeMs,
  };
}

function buildNoopBusyEntryHandle(): BusyEntryHandle {
  return { id: "test-busy-entry", update: () => undefined, clear: () => undefined };
}

function collectReachableBuffersAndViews(root: unknown): {
  buffers: Set<ArrayBufferLike>;
  views: Set<unknown>;
} {
  const buffers = new Set<ArrayBufferLike>();
  const views = new Set<unknown>();
  visitReachableValuesOnce(root, new Set(), (value) => {
    if (!ArrayBuffer.isView(value)) return;
    views.add(value);
    buffers.add(value.buffer);
  });
  return { buffers, views };
}

function visitReachableValuesOnce(
  value: unknown,
  seen: Set<unknown>,
  onValue: (value: unknown) => void,
): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  onValue(value);
  for (const child of listTraversableChildValues(value)) {
    visitReachableValuesOnce(child, seen, onValue);
  }
}

function listTraversableChildValues(value: object): ReadonlyArray<unknown> {
  if (ArrayBuffer.isView(value)) return [];
  if (value instanceof Map) return [...value.keys(), ...value.values()];
  if (value instanceof Set) return [...value.values()];
  return Object.values(value);
}

function expectNoReachableReferenceToInputBytes(
  root: unknown,
  handedOutByteArrays: ReadonlyArray<Uint8Array>,
): void {
  const reachable = collectReachableBuffersAndViews(root);
  for (const inputArray of handedOutByteArrays) {
    expect(reachable.views.has(inputArray)).toBe(false);
    expect(reachable.buffers.has(inputArray.buffer)).toBe(false);
  }
}

describe("run-open-images-flow byte release (CT-232)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a grouping proposal that holds no reference to any input byte array", async () => {
    const files = [
      buildFixtureMetadataEntry("capture_w450.tif"),
      buildFixtureMetadataEntry("capture_w501.tif"),
    ];
    const record = installFakeToolboxApiServingFixtureBytes(files);
    const result = await runOpenImagesDialogPhase({ readPhaseBusyHandle: buildNoopBusyEntryHandle() });
    expect(result.kind).toBe("review");
    expect(record.handedOutByteArrays).toHaveLength(2);
    expectNoReachableReferenceToInputBytes(result, record.handedOutByteArrays);
  });

  it("decodes the fixture into real band data before dropping the bytes", async () => {
    const files = [
      buildFixtureMetadataEntry("capture_w450.tif"),
      buildFixtureMetadataEntry("capture_w501.tif"),
    ];
    installFakeToolboxApiServingFixtureBytes(files);
    const result = await runOpenImagesDialogPhase({ readPhaseBusyHandle: buildNoopBusyEntryHandle() });
    if (result.kind !== "review") throw new Error(`expected a review result, got ${result.kind}`);
    const rows = result.proposal.groups.flatMap((group) => [...group.rows]);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.decodeError).toBeNull();
      expect(row.source?.kind).toBe("raster");
    }
  });

  it("readAndDecodeSingleOpenedImageFileOrThrow returns the decoded entry with a non-null source", async () => {
    const metadata = buildFixtureMetadataEntry("capture_single.tif");
    installFakeToolboxApiServingFixtureBytes([metadata]);
    const file = await readAndDecodeSingleOpenedImageFileOrThrow(metadata);
    expect(file.source.kind).toBe("raster");
    expect(file.contentHash).toBe("hash-capture_single.tif");
  });

  it("readAndDecodeSingleOpenedImageFileOrThrow throws the decode error for undecodable bytes", async () => {
    const metadata = buildFixtureMetadataEntry("capture_single.tif");
    vi.stubGlobal("window", {
      toolboxApi: {
        readOpenedImageFile: async () => ({
          ...metadata,
          bytes: new Uint8Array([9, 9, 9, 9]),
          contentHash: "hash-garbage",
        }),
      },
    });
    await expect(readAndDecodeSingleOpenedImageFileOrThrow(metadata)).rejects.toThrow();
  });

  it("returns a single decoded file entry that holds no reference to the input byte array", async () => {
    const metadata = buildFixtureMetadataEntry("capture_single.tif");
    const record = installFakeToolboxApiServingFixtureBytes([metadata]);
    const file = await readAndDecodeSingleOpenedImageFile(metadata);
    expect(file.decodeError).toBeNull();
    expect(file.source?.kind).toBe("raster");
    expect(file.contentHash).toBe("hash-capture_single.tif");
    expect(record.handedOutByteArrays).toHaveLength(1);
    expectNoReachableReferenceToInputBytes(file, record.handedOutByteArrays);
  });
});
