import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  writeProjectBundleAtPath,
  type BundleDraft,
  type BundleDraftViewportEntry,
} from "./bundle-writer";
import { extractProjectBundleToFreshTempDirectory } from "./extract-project-bundle";

let workspaceDir: string;

beforeAll(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), "save-bundle-test-"));
});

afterAll(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

async function writeExternalSourceFixture(
  fileName: string,
  marker: string,
): Promise<{ absolutePath: string; bytes: Uint8Array }> {
  const absolutePath = join(workspaceDir, fileName);
  const bytes = new TextEncoder().encode(`fixture-${marker}`);
  await writeFile(absolutePath, bytes);
  return { absolutePath, bytes };
}

function buildExternalAssetViewport(
  index: number,
  fileName: string,
  absolutePath: string,
): BundleDraftViewportEntry {
  return {
    index,
    fileName,
    asset: { kind: "external", absolutePath, extension: extensionOf(fileName) },
    renderingState: {
      normalizationEnabled: false,
      selectedBandIndex: 0,
      lastAppliedOperationLabel: null,
    },
    operationHistory: [],
  };
}

function buildBakedTiffAssetViewport(
  index: number,
  fileName: string,
  bytes: Uint8Array,
): BundleDraftViewportEntry {
  return {
    index,
    fileName,
    asset: { kind: "baked", bytes, extension: "tif" },
    renderingState: {
      normalizationEnabled: false,
      selectedBandIndex: 0,
      lastAppliedOperationLabel: null,
    },
    operationHistory: [],
  };
}

function buildBakedEnviAssetViewport(
  index: number,
  fileName: string,
  headerBytes: Uint8Array,
  binaryBytes: Uint8Array,
): BundleDraftViewportEntry {
  return {
    index,
    fileName,
    asset: {
      kind: "baked",
      bytes: headerBytes,
      extension: "hdr",
      sidecar: { extension: "bin", bytes: binaryBytes },
    },
    renderingState: {
      normalizationEnabled: false,
      selectedBandIndex: 0,
      lastAppliedOperationLabel: null,
    },
    operationHistory: [],
  };
}

function buildDraftFromViewports(
  viewports: ReadonlyArray<BundleDraftViewportEntry>,
  options: Partial<Pick<BundleDraft, "gridLayout" | "selectedViewportIndices">> = {},
): BundleDraft {
  return {
    formatVersion: 2,
    gridLayout: options.gridLayout ?? "1x1",
    selectedViewportIndices: options.selectedViewportIndices ?? [],
    viewports,
  };
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1) : "";
}

describe("writeProjectBundleAtPath round-trip", () => {
  it("writes a zip with project.json plus a baked asset and rewritten path", async () => {
    const tifBytes = new TextEncoder().encode("fake-tiff-bytes");
    const draft = buildDraftFromViewports([
      buildBakedTiffAssetViewport(0, "sample.tif", tifBytes),
    ]);
    const bundlePath = join(workspaceDir, "baked.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const projectJsonText = await readFile(join(extractedDir, "project.json"), "utf-8");
      const parsed = JSON.parse(projectJsonText) as {
        viewports: ReadonlyArray<{ source: { relativePath: string; fileName: string } }>;
      };
      expect(parsed.viewports[0]!.source.relativePath).toBe("assets/viewport-0.tif");
      expect(parsed.viewports[0]!.source.fileName).toBe("sample.tif");
      const tifBack = await readFile(join(extractedDir, "assets", "viewport-0.tif"));
      expect(new Uint8Array(tifBack)).toEqual(tifBytes);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });

  it("includes baked ENVI .bin sidecars under the same viewport stem", async () => {
    const headerBytes = new TextEncoder().encode("hdr-bytes");
    const binaryBytes = new TextEncoder().encode("bin-bytes");
    const draft = buildDraftFromViewports([
      buildBakedEnviAssetViewport(0, "cube.hdr", headerBytes, binaryBytes),
    ]);
    const bundlePath = join(workspaceDir, "envi.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const headerBack = await readFile(join(extractedDir, "assets", "viewport-0.hdr"));
      const binaryBack = await readFile(join(extractedDir, "assets", "viewport-0.bin"));
      expect(new Uint8Array(headerBack)).toEqual(headerBytes);
      expect(new Uint8Array(binaryBack)).toEqual(binaryBytes);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });

  it("streams external-source files from disk into the bundle assets folder", async () => {
    const fixture = await writeExternalSourceFixture("photo.png", "external");
    const draft = buildDraftFromViewports([
      buildExternalAssetViewport(0, "photo.png", fixture.absolutePath),
    ]);
    const bundlePath = join(workspaceDir, "external.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const back = await readFile(join(extractedDir, "assets", "viewport-0.png"));
      expect(new Uint8Array(back)).toEqual(fixture.bytes);
      const projectJsonText = await readFile(join(extractedDir, "project.json"), "utf-8");
      const parsed = JSON.parse(projectJsonText) as {
        viewports: ReadonlyArray<{ source: { relativePath: string } }>;
      };
      expect(parsed.viewports[0]!.source.relativePath).toBe("assets/viewport-0.png");
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });

  it("preserves selectedViewportIndices and gridLayout in the rewritten project.json", async () => {
    const tifBytes = new TextEncoder().encode("fake-tiff-bytes");
    const draft = buildDraftFromViewports(
      [
        buildBakedTiffAssetViewport(0, "a.tif", tifBytes),
        buildBakedTiffAssetViewport(2, "b.tif", tifBytes),
      ],
      { gridLayout: "2x2", selectedViewportIndices: [0, 2] },
    );
    const bundlePath = join(workspaceDir, "preserve.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const projectJsonText = await readFile(join(extractedDir, "project.json"), "utf-8");
      const parsed = JSON.parse(projectJsonText) as {
        gridLayout: string;
        selectedViewportIndices: ReadonlyArray<number>;
        viewports: ReadonlyArray<{ index: number }>;
      };
      expect(parsed.gridLayout).toBe("2x2");
      expect(parsed.selectedViewportIndices).toEqual([0, 2]);
      expect(parsed.viewports.map((v) => v.index)).toEqual([0, 2]);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });
});
