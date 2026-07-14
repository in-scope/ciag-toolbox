// CT-236: reopening a project resolves each bundle asset to metadata and
// streams its bytes through the chunked opened-image path - an ENVI asset
// feeds its .bin sidecar chunks straight into the CT-231 streaming decoder.
// These tests drive the REAL flow over the real e2e fixtures through a fake
// window.toolboxApi whose chunk size forces a final short chunk, and pin the
// decoded band data against the direct whole-buffer ENVI reader.

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseEnviHeaderText } from "@/lib/image/parse-envi-header";
import { readEnviBinaryAsBandPixels } from "@/lib/image/read-envi-binary";
import {
  runOpenProjectFlowThroughMainProcess,
  type OpenProjectFlowProgressEvent,
} from "@/lib/project/run-open-project-flow";

const ENVI_HEADER_PATH = fileURLToPath(
  new URL("../../../../../e2e/fixtures/envi-stack.hdr", import.meta.url),
);
const ENVI_BINARY_PATH = fileURLToPath(
  new URL("../../../../../e2e/fixtures/envi-stack.bin", import.meta.url),
);
const TIFF_PATH = fileURLToPath(
  new URL("../../../../../e2e/fixtures/multiband-12bit.tif", import.meta.url),
);

// Small enough that the 96-byte fixture binary ends on a short chunk (96 = 13*7 + 5).
const TEST_CHUNK_BYTES = 7;

const PROJECT_FILE_PATH = "C:\\bundles\\extracted\\project.json";

function buildProjectViewportEntry(index: number, relativePath: string, fileName: string) {
  return {
    index,
    source: { relativePath, fileName },
    renderingState: {
      normalizationEnabled: false,
      selectedBandIndex: 0,
      lastAppliedOperationLabel: null,
    },
    viewTransform: { zoom: 1, panX: 0, panY: 0 },
    operationHistory: [],
    roi: null,
  };
}

function buildProjectJsonBytes(
  viewports: ReadonlyArray<ReturnType<typeof buildProjectViewportEntry>>,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      formatVersion: 2,
      gridLayout: "2x2",
      selectedViewportIndices: [],
      viewports,
    }),
  );
}

interface FakeChunkedReadSession {
  file: { bytes: Uint8Array; offset: number };
  sidecar: { bytes: Uint8Array; offset: number } | null;
}

function sliceNextChunkOfTarget(target: {
  bytes: Uint8Array;
  offset: number;
}): { done: boolean; bytes: Uint8Array } {
  const bytes = target.bytes.slice(target.offset, target.offset + TEST_CHUNK_BYTES);
  target.offset += bytes.byteLength;
  return { done: target.offset >= target.bytes.byteLength, bytes };
}

function installFakeToolboxApiOverRealFixtures(
  projectJsonBytes: Uint8Array,
  assetPathsByRelativePath: Readonly<Record<string, string>>,
): void {
  const sessions = new Map<string, FakeChunkedReadSession>();
  vi.stubGlobal("window", {
    toolboxApi: {
      openProjectBundleDialog: async () => ({
        canceled: false,
        projectFilePath: PROJECT_FILE_PATH,
        bytes: projectJsonBytes,
      }),
      resolveProjectBundleAsset: async (request: ToolboxResolveBundleAssetRequest) =>
        resolveFakeBundleAsset(request, assetPathsByRelativePath),
      readOpenedImageFile: async (metadata: ToolboxOpenImagesDialogFileMetadataEntry) => ({
        ...metadata,
        bytes: new Uint8Array(readFileSync(metadata.filePath)),
        contentHash: `hash-${metadata.fileName}`,
      }),
      beginOpenedImageChunkedRead: async (request: { filePath: string }) =>
        beginFakeChunkedRead(sessions, request.filePath),
      readOpenedImageChunk: async (request: { token: string; target: "file" | "sidecar" }) => {
        const session = sessions.get(request.token)!;
        const target = request.target === "file" ? session.file : session.sidecar!;
        return sliceNextChunkOfTarget(target);
      },
      finishOpenedImageChunkedRead: async (request: { token: string }) => {
        sessions.delete(request.token);
        return { contentHash: "hash-envi-header" };
      },
      abortOpenedImageChunkedRead: async (request: { token: string }) => {
        sessions.delete(request.token);
      },
    },
  });
}

function resolveFakeBundleAsset(
  request: ToolboxResolveBundleAssetRequest,
  assetPathsByRelativePath: Readonly<Record<string, string>>,
): ToolboxResolveBundleAssetResult {
  const filePath = assetPathsByRelativePath[request.relativePath];
  if (filePath === undefined) {
    return { kind: "missing", relativePath: request.relativePath };
  }
  const fileName = filePath.split(/[\\/]/).pop()!;
  return {
    kind: "found",
    file: { fileName, filePath, fileSizeBytes: statSync(filePath).size, mtimeMs: 1000 },
  };
}

function beginFakeChunkedRead(
  sessions: Map<string, FakeChunkedReadSession>,
  filePath: string,
): { token: string; fileSizeBytes: number; sidecar: { fileName: string; sizeBytes: number } | null } {
  const fileBytes = new Uint8Array(readFileSync(filePath));
  const sidecarPath = filePath.toLowerCase().endsWith(".hdr")
    ? filePath.replace(/\.hdr$/i, ".bin")
    : null;
  const sidecarBytes = sidecarPath === null ? null : new Uint8Array(readFileSync(sidecarPath));
  const token = `token-${sessions.size}`;
  sessions.set(token, {
    file: { bytes: fileBytes, offset: 0 },
    sidecar: sidecarBytes === null ? null : { bytes: sidecarBytes, offset: 0 },
  });
  return {
    token,
    fileSizeBytes: fileBytes.byteLength,
    sidecar:
      sidecarBytes === null
        ? null
        : { fileName: "envi-stack.bin", sizeBytes: sidecarBytes.byteLength },
  };
}

function readExpectedEnviBandPixelsDirectly() {
  const header = parseEnviHeaderText(readFileSync(ENVI_HEADER_PATH, "utf-8"));
  return readEnviBinaryAsBandPixels(header, new Uint8Array(readFileSync(ENVI_BINARY_PATH)));
}

describe("runOpenProjectFlowThroughMainProcess (CT-236 chunked asset read)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams an ENVI bundle asset through chunks into band data identical to the whole-buffer reader", async () => {
    const entry = buildProjectViewportEntry(0, "assets/stack.hdr", "stack.hdr");
    installFakeToolboxApiOverRealFixtures(buildProjectJsonBytes([entry]), {
      "assets/stack.hdr": ENVI_HEADER_PATH,
    });
    const result = await runOpenProjectFlowThroughMainProcess();
    if (result.canceled) throw new Error("expected the flow to open a project");
    const [viewport] = result.opened.resolvedViewports;
    expect(viewport?.source.kind).toBe("raster");
    if (viewport?.source.kind !== "raster") return;
    const expectedBands = readExpectedEnviBandPixelsDirectly();
    expect(viewport.source.raster.bandPixels).toHaveLength(expectedBands.length);
    for (let band = 0; band < expectedBands.length; band++) {
      expect(viewport.source.raster.bandPixels[band]).toEqual(expectedBands[band]);
    }
  });

  it("carries the resolved absolute path and file size onto the viewport snapshot", async () => {
    const entry = buildProjectViewportEntry(0, "assets/stack.hdr", "stack.hdr");
    installFakeToolboxApiOverRealFixtures(buildProjectJsonBytes([entry]), {
      "assets/stack.hdr": ENVI_HEADER_PATH,
    });
    const result = await runOpenProjectFlowThroughMainProcess();
    if (result.canceled) throw new Error("expected the flow to open a project");
    const [viewport] = result.opened.resolvedViewports;
    expect(viewport?.originalFilePath).toBe(ENVI_HEADER_PATH);
    expect(viewport?.fileSizeBytes).toBe(statSync(ENVI_HEADER_PATH).size);
    expect(viewport?.fileName).toBe("stack.hdr");
  });

  it("decodes a non-ENVI asset through the chunk-assembling read path", async () => {
    const entry = buildProjectViewportEntry(0, "assets/photo.tif", "photo.tif");
    installFakeToolboxApiOverRealFixtures(buildProjectJsonBytes([entry]), {
      "assets/photo.tif": TIFF_PATH,
    });
    const result = await runOpenProjectFlowThroughMainProcess();
    if (result.canceled) throw new Error("expected the flow to open a project");
    expect(result.opened.resolvedViewports[0]?.source.kind).toBe("raster");
  });

  it("throws the missing-asset error when the asset cannot be resolved", async () => {
    const entry = buildProjectViewportEntry(0, "assets/vanished.hdr", "vanished.hdr");
    installFakeToolboxApiOverRealFixtures(buildProjectJsonBytes([entry]), {});
    await expect(runOpenProjectFlowThroughMainProcess()).rejects.toThrow(
      /assets\/vanished\.hdr" is missing or unreadable/,
    );
  });

  it("reports monotonic progress with a within-asset fraction and a final completed event", async () => {
    const entries = [
      buildProjectViewportEntry(0, "assets/stack.hdr", "stack.hdr"),
      buildProjectViewportEntry(1, "assets/photo.tif", "photo.tif"),
    ];
    installFakeToolboxApiOverRealFixtures(buildProjectJsonBytes(entries), {
      "assets/stack.hdr": ENVI_HEADER_PATH,
      "assets/photo.tif": TIFF_PATH,
    });
    const events: OpenProjectFlowProgressEvent[] = [];
    await runOpenProjectFlowThroughMainProcess({ onProgress: (event) => events.push(event) });
    const overallFractions = events.map(
      (event) => (event.readAssetCount + event.currentAssetFraction) / event.totalAssetCount,
    );
    for (let index = 1; index < overallFractions.length; index++) {
      expect(overallFractions[index]).toBeGreaterThanOrEqual(overallFractions[index - 1]!);
    }
    expect(events.some((event) => event.currentAssetFraction > 0)).toBe(true);
    expect(events.at(-1)).toEqual({
      readAssetCount: 2,
      totalAssetCount: 2,
      currentAssetFraction: 0,
    });
  });
});
