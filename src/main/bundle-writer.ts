import { createWriteStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { ZipFile } from "yazl";

const ENVI_HEADER_EXTENSION = ".hdr";
const ENVI_BINARY_EXTENSION_CANDIDATES: ReadonlyArray<string> = [
  ".bin",
  ".dat",
  ".img",
  ".raw",
  "",
];

export interface PackBundleDraftViewportSource {
  readonly absolutePath: string;
  readonly contentHash: string;
  readonly fileName: string;
}

export interface PackBundleDraftViewportRenderingState {
  readonly normalizationEnabled: boolean;
  readonly selectedBandIndex: number;
  readonly lastAppliedOperationLabel: string | null;
}

export interface PackBundleDraftViewportEntry {
  readonly index: number;
  readonly source: PackBundleDraftViewportSource;
  readonly renderingState: PackBundleDraftViewportRenderingState;
}

export interface PackBundleDraft {
  readonly formatVersion: number;
  readonly gridLayout: string;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<PackBundleDraftViewportEntry>;
}

export interface BundleEnviSiblingPlan {
  readonly sourceAbsolutePath: string;
  readonly metadataPath: string;
}

export interface BundleAssetPlan {
  readonly assetPathByAbsoluteSourcePath: ReadonlyMap<string, string>;
  readonly enviSiblings: ReadonlyArray<BundleEnviSiblingPlan>;
}

export async function writeProjectBundleAtPath(
  outputPath: string,
  draft: PackBundleDraft,
): Promise<void> {
  const plan = await buildBundleAssetPlanForViewports(draft.viewports);
  await streamBundleZipFileToOutputPath(outputPath, draft, plan);
}

async function streamBundleZipFileToOutputPath(
  outputPath: string,
  draft: PackBundleDraft,
  plan: BundleAssetPlan,
): Promise<void> {
  const zip = new ZipFile();
  const completion = pipeZipOutputStreamToFile(zip, outputPath);
  appendProjectJsonEntryToZip(zip, draft, plan);
  appendSourceAssetEntriesToZip(zip, plan);
  zip.end();
  await completion;
}

function pipeZipOutputStreamToFile(zip: ZipFile, outputPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(outputPath);
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
    };
    writeStream.on("close", () => settle(resolve));
    writeStream.on("error", (err) => settle(() => reject(err)));
    zip.outputStream.on("error", (err) => settle(() => reject(err)));
    zip.outputStream.pipe(writeStream);
  });
}

function appendProjectJsonEntryToZip(
  zip: ZipFile,
  draft: PackBundleDraft,
  plan: BundleAssetPlan,
): void {
  const buffer = buildBundleProjectJsonBuffer(draft, plan);
  zip.addBuffer(buffer, "project.json");
}

function appendSourceAssetEntriesToZip(zip: ZipFile, plan: BundleAssetPlan): void {
  for (const [absolutePath, metadataPath] of plan.assetPathByAbsoluteSourcePath) {
    zip.addFile(absolutePath, metadataPath);
  }
  for (const sibling of plan.enviSiblings) {
    zip.addFile(sibling.sourceAbsolutePath, sibling.metadataPath);
  }
}

function buildBundleProjectJsonBuffer(
  draft: PackBundleDraft,
  plan: BundleAssetPlan,
): Buffer {
  const data = {
    formatVersion: draft.formatVersion,
    gridLayout: draft.gridLayout,
    selectedViewportIndices: draft.selectedViewportIndices,
    viewports: draft.viewports.map((entry) =>
      buildBundleViewportEntryWithRewrittenPath(entry, plan),
    ),
  };
  return Buffer.from(JSON.stringify(data, null, 2), "utf-8");
}

function buildBundleViewportEntryWithRewrittenPath(
  entry: PackBundleDraftViewportEntry,
  plan: BundleAssetPlan,
): unknown {
  const rewrittenRelativePath = lookupRewrittenAssetPathOrThrow(
    entry.source.absolutePath,
    plan,
  );
  return {
    index: entry.index,
    source: {
      relativePath: rewrittenRelativePath,
      contentHash: entry.source.contentHash,
      fileName: entry.source.fileName,
    },
    renderingState: entry.renderingState,
    viewTransform: { zoom: 1, panX: 0, panY: 0 },
    operationHistory: [],
    roi: null,
  };
}

function lookupRewrittenAssetPathOrThrow(
  absolutePath: string,
  plan: BundleAssetPlan,
): string {
  const rewritten = plan.assetPathByAbsoluteSourcePath.get(absolutePath);
  if (!rewritten) {
    throw new Error(`Bundle plan missing asset path for ${absolutePath}`);
  }
  return rewritten;
}

export async function buildBundleAssetPlanForViewports(
  viewports: ReadonlyArray<PackBundleDraftViewportEntry>,
): Promise<BundleAssetPlan> {
  const accumulator: MutableAssetPlanAccumulator = {
    assetPathByAbsoluteSourcePath: new Map<string, string>(),
    enviSiblings: [],
    usedAssetFileNames: new Set<string>(),
  };
  for (const viewport of viewports) {
    await collectAssetMappingsForViewport(viewport, accumulator);
  }
  return {
    assetPathByAbsoluteSourcePath: accumulator.assetPathByAbsoluteSourcePath,
    enviSiblings: accumulator.enviSiblings,
  };
}

interface MutableAssetPlanAccumulator {
  readonly assetPathByAbsoluteSourcePath: Map<string, string>;
  readonly enviSiblings: BundleEnviSiblingPlan[];
  readonly usedAssetFileNames: Set<string>;
}

async function collectAssetMappingsForViewport(
  viewport: PackBundleDraftViewportEntry,
  accumulator: MutableAssetPlanAccumulator,
): Promise<void> {
  if (accumulator.assetPathByAbsoluteSourcePath.has(viewport.source.absolutePath)) return;
  const chosenAssetFileName = pickUniqueAssetFileName(
    viewport.source.fileName,
    accumulator.usedAssetFileNames,
  );
  accumulator.usedAssetFileNames.add(chosenAssetFileName);
  accumulator.assetPathByAbsoluteSourcePath.set(
    viewport.source.absolutePath,
    `assets/${chosenAssetFileName}`,
  );
  await appendEnviSiblingPlanIfApplicable(
    viewport.source.absolutePath,
    chosenAssetFileName,
    accumulator,
  );
}

async function appendEnviSiblingPlanIfApplicable(
  hdrAbsolutePath: string,
  hdrAssetFileName: string,
  accumulator: MutableAssetPlanAccumulator,
): Promise<void> {
  const sibling = await findEnviSiblingPlanOrUndefined(
    hdrAbsolutePath,
    hdrAssetFileName,
    accumulator.usedAssetFileNames,
  );
  if (!sibling) return;
  accumulator.enviSiblings.push(sibling);
  accumulator.usedAssetFileNames.add(basename(sibling.metadataPath));
}

async function findEnviSiblingPlanOrUndefined(
  hdrAbsolutePath: string,
  hdrAssetFileName: string,
  usedAssetFileNames: ReadonlySet<string>,
): Promise<BundleEnviSiblingPlan | undefined> {
  if (extname(hdrAbsolutePath).toLowerCase() !== ENVI_HEADER_EXTENSION) return undefined;
  const sourceSiblingPath = await findEnviBinarySiblingAbsolutePathOrUndefined(hdrAbsolutePath);
  if (!sourceSiblingPath) return undefined;
  const siblingFileName = pickUniqueSiblingFileName(
    hdrAssetFileName,
    sourceSiblingPath,
    usedAssetFileNames,
  );
  return { sourceAbsolutePath: sourceSiblingPath, metadataPath: `assets/${siblingFileName}` };
}

function pickUniqueSiblingFileName(
  hdrAssetFileName: string,
  sourceSiblingPath: string,
  usedAssetFileNames: ReadonlySet<string>,
): string {
  const stem = basename(hdrAssetFileName, extname(hdrAssetFileName));
  const sourceSiblingExt = extname(sourceSiblingPath);
  const candidate = `${stem}${sourceSiblingExt}`;
  if (!usedAssetFileNames.has(candidate)) return candidate;
  return pickUniqueAssetFileName(candidate, usedAssetFileNames);
}

export function pickUniqueAssetFileName(
  fileName: string,
  used: ReadonlySet<string>,
): string {
  if (!used.has(fileName)) return fileName;
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex > 0 ? fileName.slice(dotIndex) : "";
  for (let counter = 1; counter < 10000; counter++) {
    const candidate = `${stem}-${counter}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Could not find a unique asset filename for ${fileName}`);
}

async function findEnviBinarySiblingAbsolutePathOrUndefined(
  hdrPath: string,
): Promise<string | undefined> {
  const directoryEntries = await readDirectoryEntriesIgnoringErrors(dirname(hdrPath));
  const matching = pickEnviBinarySiblingFromEntries(hdrPath, directoryEntries);
  if (!matching) return undefined;
  return join(dirname(hdrPath), matching);
}

async function readDirectoryEntriesIgnoringErrors(
  dir: string,
): Promise<ReadonlyArray<string>> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

function pickEnviBinarySiblingFromEntries(
  hdrPath: string,
  entries: ReadonlyArray<string>,
): string | undefined {
  const baseLower = basename(hdrPath, extname(hdrPath)).toLowerCase();
  for (const candidate of ENVI_BINARY_EXTENSION_CANDIDATES) {
    const match = entries.find((entry) =>
      entryMatchesEnviSiblingCandidate(entry, baseLower, candidate),
    );
    if (match) return match;
  }
  return undefined;
}

function entryMatchesEnviSiblingCandidate(
  entry: string,
  baseLower: string,
  expectedExtensionLower: string,
): boolean {
  const entryLower = entry.toLowerCase();
  if (expectedExtensionLower === "") return entryLower === baseLower;
  return entryLower === baseLower + expectedExtensionLower;
}
