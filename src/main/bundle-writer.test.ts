import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildBundleAssetPlanForViewports,
  pickUniqueAssetFileName,
  writeProjectBundleAtPath,
  type PackBundleDraft,
  type PackBundleDraftViewportEntry,
} from "./bundle-writer";
import { extractProjectBundleToFreshTempDirectory } from "./extract-project-bundle";

interface TestSourceFile {
  readonly absolutePath: string;
  readonly fileName: string;
  readonly contentHash: string;
  readonly bytes: Uint8Array;
}

interface TestEnviPair {
  readonly headerPath: string;
  readonly headerFileName: string;
  readonly headerBytes: Uint8Array;
  readonly headerHash: string;
  readonly binaryBytes: Uint8Array;
}

let workspaceDir: string;

beforeAll(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), "pack-bundle-test-"));
});

afterAll(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

async function writeTifFixtureForTest(
  fileName: string,
  marker: string,
): Promise<TestSourceFile> {
  const absolutePath = join(workspaceDir, fileName);
  const bytes = new TextEncoder().encode(`fixture-${marker}`);
  await writeFile(absolutePath, bytes);
  return { absolutePath, fileName, contentHash: `hash-${marker}`, bytes };
}

async function writeEnviPairFixtureForTest(
  baseName: string,
  marker: string,
): Promise<TestEnviPair> {
  const subdir = join(workspaceDir, `envi-${marker}`);
  await mkdir(subdir, { recursive: true });
  const headerPath = join(subdir, `${baseName}.hdr`);
  const binaryPath = join(subdir, `${baseName}.bin`);
  const headerBytes = new TextEncoder().encode(`hdr-${marker}`);
  const binaryBytes = new TextEncoder().encode(`bin-${marker}`);
  await writeFile(headerPath, headerBytes);
  await writeFile(binaryPath, binaryBytes);
  return {
    headerPath,
    headerFileName: `${baseName}.hdr`,
    headerBytes,
    headerHash: `envi-hash-${marker}`,
    binaryBytes,
  };
}

function buildDraftViewportEntryForFixture(
  index: number,
  source: TestSourceFile,
): PackBundleDraftViewportEntry {
  return {
    index,
    source: {
      absolutePath: source.absolutePath,
      contentHash: source.contentHash,
      fileName: source.fileName,
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
  viewports: ReadonlyArray<PackBundleDraftViewportEntry>,
): PackBundleDraft {
  return {
    formatVersion: 1,
    gridLayout: "1x1",
    selectedViewportIndices: [],
    viewports,
  };
}

describe("pickUniqueAssetFileName", () => {
  it("returns the original name when not used", () => {
    expect(pickUniqueAssetFileName("img.tif", new Set())).toBe("img.tif");
  });

  it("appends a counter suffix on first collision", () => {
    expect(pickUniqueAssetFileName("img.tif", new Set(["img.tif"]))).toBe("img-1.tif");
  });

  it("keeps incrementing the counter past further collisions", () => {
    const used = new Set(["img.tif", "img-1.tif", "img-2.tif"]);
    expect(pickUniqueAssetFileName("img.tif", used)).toBe("img-3.tif");
  });

  it("appends -1 to a name without an extension", () => {
    expect(pickUniqueAssetFileName("README", new Set(["README"]))).toBe("README-1");
  });

  it("treats a leading-dot file as having no extension", () => {
    expect(pickUniqueAssetFileName(".env", new Set([".env"]))).toBe(".env-1");
  });
});

describe("buildBundleAssetPlanForViewports", () => {
  it("dedupes viewports that share an absolute path", async () => {
    const tif = await writeTifFixtureForTest("dedupe.tif", "dedupe");
    const plan = await buildBundleAssetPlanForViewports([
      buildDraftViewportEntryForFixture(0, tif),
      buildDraftViewportEntryForFixture(1, tif),
    ]);
    expect(plan.assetPathByAbsoluteSourcePath.size).toBe(1);
    expect(plan.assetPathByAbsoluteSourcePath.get(tif.absolutePath)).toBe("assets/dedupe.tif");
  });

  it("uniquifies asset filenames when two viewports collide on basename only", async () => {
    const a = await writeTifFixtureForTest("collide.tif", "a");
    const subdir = join(workspaceDir, "second");
    await mkdir(subdir, { recursive: true });
    const otherPath = join(subdir, "collide.tif");
    await writeFile(otherPath, new TextEncoder().encode("second-collide"));
    const b: TestSourceFile = {
      absolutePath: otherPath,
      fileName: "collide.tif",
      contentHash: "hash-b",
      bytes: new TextEncoder().encode("second-collide"),
    };
    const plan = await buildBundleAssetPlanForViewports([
      buildDraftViewportEntryForFixture(0, a),
      buildDraftViewportEntryForFixture(1, b),
    ]);
    expect(plan.assetPathByAbsoluteSourcePath.get(a.absolutePath)).toBe("assets/collide.tif");
    expect(plan.assetPathByAbsoluteSourcePath.get(b.absolutePath)).toBe("assets/collide-1.tif");
  });

  it("plans the ENVI .bin sibling alongside the .hdr asset", async () => {
    const envi = await writeEnviPairFixtureForTest("cube", "alongside");
    const plan = await buildBundleAssetPlanForViewports([
      buildDraftViewportEntryForFixture(0, {
        absolutePath: envi.headerPath,
        fileName: envi.headerFileName,
        contentHash: envi.headerHash,
        bytes: envi.headerBytes,
      }),
    ]);
    expect(plan.assetPathByAbsoluteSourcePath.get(envi.headerPath)).toBe("assets/cube.hdr");
    expect(plan.enviSiblings).toHaveLength(1);
    const sibling = plan.enviSiblings[0]!;
    expect(sibling.metadataPath).toBe("assets/cube.bin");
    expect(sibling.sourceAbsolutePath.endsWith("cube.bin")).toBe(true);
  });
});

describe("writeProjectBundleAtPath round-trip", () => {
  it("writes a zip with project.json plus the source asset, with a rewritten relativePath", async () => {
    const tif = await writeTifFixtureForTest("simple.tif", "simple");
    const draft = buildDraftFromViewports([buildDraftViewportEntryForFixture(0, tif)]);
    const bundlePath = join(workspaceDir, "simple.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const projectJsonText = await readFile(join(extractedDir, "project.json"), "utf-8");
      const parsed: unknown = JSON.parse(projectJsonText);
      const root = parsed as {
        viewports: ReadonlyArray<{ source: { relativePath: string; fileName: string } }>;
      };
      expect(root.viewports[0]!.source.relativePath).toBe("assets/simple.tif");
      expect(root.viewports[0]!.source.fileName).toBe("simple.tif");
      const tifBytes = await readFile(join(extractedDir, "assets", "simple.tif"));
      expect(new Uint8Array(tifBytes)).toEqual(tif.bytes);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });

  it("includes ENVI .bin siblings inside assets/ alongside the .hdr", async () => {
    const envi = await writeEnviPairFixtureForTest("roundtrip", "roundtrip");
    const draft = buildDraftFromViewports([
      buildDraftViewportEntryForFixture(0, {
        absolutePath: envi.headerPath,
        fileName: envi.headerFileName,
        contentHash: envi.headerHash,
        bytes: envi.headerBytes,
      }),
    ]);
    const bundlePath = join(workspaceDir, "roundtrip.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const headerBytes = await readFile(join(extractedDir, "assets", "roundtrip.hdr"));
      const binaryBytes = await readFile(join(extractedDir, "assets", "roundtrip.bin"));
      expect(new Uint8Array(headerBytes)).toEqual(envi.headerBytes);
      expect(new Uint8Array(binaryBytes)).toEqual(envi.binaryBytes);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });

  it("preserves selectedViewportIndices and gridLayout in the rewritten project.json", async () => {
    const tif = await writeTifFixtureForTest("preserve.tif", "preserve");
    const draft: PackBundleDraft = {
      formatVersion: 1,
      gridLayout: "2x2",
      selectedViewportIndices: [0, 2],
      viewports: [
        buildDraftViewportEntryForFixture(0, tif),
        buildDraftViewportEntryForFixture(2, tif),
      ],
    };
    const bundlePath = join(workspaceDir, "preserve.ctbundle");
    await writeProjectBundleAtPath(bundlePath, draft);
    const extractedDir = await extractProjectBundleToFreshTempDirectory(bundlePath);
    try {
      const projectJsonText = await readFile(join(extractedDir, "project.json"), "utf-8");
      const parsed: unknown = JSON.parse(projectJsonText);
      const root = parsed as {
        gridLayout: string;
        selectedViewportIndices: ReadonlyArray<number>;
        viewports: ReadonlyArray<{ index: number }>;
      };
      expect(root.gridLayout).toBe("2x2");
      expect(root.selectedViewportIndices).toEqual([0, 2]);
      expect(root.viewports.map((v) => v.index)).toEqual([0, 2]);
    } finally {
      await rm(extractedDir, { recursive: true, force: true });
    }
  });
});
