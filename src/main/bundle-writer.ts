import { createWriteStream } from "node:fs";
import { ZipFile } from "yazl";

import { findEnviBinarySiblingPathOrNull } from "./envi-binary-sibling";

const BUNDLE_FORMAT_VERSION = 2;

const ENVI_HEADER_ASSET_EXTENSION = "hdr";
const ENVI_BINARY_SIDECAR_EXTENSION = "bin";

export type BundleDraftOperationHistoryParameterValue = number | string | boolean;

export interface BundleDraftOperationHistoryEntry {
  readonly actionId: string;
  readonly actionLabel: string;
  readonly appliedLabel: string;
  readonly parameterValues: Readonly<
    Record<string, BundleDraftOperationHistoryParameterValue>
  >;
  readonly timestampMs: number;
}

export interface BundleDraftViewportRenderingState {
  readonly normalizationEnabled: boolean;
  readonly selectedBandIndex: number;
  readonly lastAppliedOperationLabel: string | null;
}

export interface BundleDraftBakedAssetSidecar {
  readonly extension: string;
  readonly bytes: Uint8Array;
}

export interface BundleDraftBakedAsset {
  readonly kind: "baked";
  readonly bytes: Uint8Array;
  readonly extension: string;
  readonly sidecar?: BundleDraftBakedAssetSidecar;
}

export interface BundleDraftExternalAsset {
  readonly kind: "external";
  readonly absolutePath: string;
  readonly extension: string;
}

export type BundleDraftAsset = BundleDraftBakedAsset | BundleDraftExternalAsset;

export interface BundleDraftViewportEntry {
  readonly index: number;
  readonly fileName: string;
  readonly asset: BundleDraftAsset;
  readonly renderingState: BundleDraftViewportRenderingState;
  readonly operationHistory: ReadonlyArray<BundleDraftOperationHistoryEntry>;
}

export interface BundleDraft {
  readonly formatVersion: number;
  readonly gridLayout: string;
  readonly selectedViewportIndices: ReadonlyArray<number>;
  readonly viewports: ReadonlyArray<BundleDraftViewportEntry>;
}

interface ResolvedBundleAssetPaths {
  readonly viewportIndex: number;
  readonly primaryRelativePath: string;
  readonly sidecarRelativePath: string | null;
}

export async function writeProjectBundleAtPath(
  outputPath: string,
  draft: BundleDraft,
): Promise<void> {
  const assetPaths = planBundleAssetRelativePathsForViewports(draft.viewports);
  await streamBundleZipFileToOutputPath(outputPath, draft, assetPaths);
}

export function planBundleAssetRelativePathsForViewports(
  viewports: ReadonlyArray<BundleDraftViewportEntry>,
): ReadonlyArray<ResolvedBundleAssetPaths> {
  return viewports.map(buildAssetPathsForViewport);
}

function buildAssetPathsForViewport(
  viewport: BundleDraftViewportEntry,
): ResolvedBundleAssetPaths {
  const stem = `viewport-${viewport.index}`;
  return {
    viewportIndex: viewport.index,
    primaryRelativePath: `assets/${stem}.${viewport.asset.extension}`,
    sidecarRelativePath: pickSidecarRelativePathOrNull(stem, viewport.asset),
  };
}

function pickSidecarRelativePathOrNull(stem: string, asset: BundleDraftAsset): string | null {
  if (asset.kind === "baked" && asset.sidecar) {
    return `assets/${stem}.${asset.sidecar.extension}`;
  }
  if (asset.kind === "external" && isEnviHeaderAsset(asset)) {
    return `assets/${stem}.${ENVI_BINARY_SIDECAR_EXTENSION}`;
  }
  return null;
}

function isEnviHeaderAsset(asset: BundleDraftExternalAsset): boolean {
  return asset.extension.toLowerCase() === ENVI_HEADER_ASSET_EXTENSION;
}

async function streamBundleZipFileToOutputPath(
  outputPath: string,
  draft: BundleDraft,
  assetPaths: ReadonlyArray<ResolvedBundleAssetPaths>,
): Promise<void> {
  const zip = new ZipFile();
  const completion = pipeZipOutputStreamToFile(zip, outputPath);
  appendProjectJsonEntryToZip(zip, draft, assetPaths);
  await appendAllAssetEntriesToZip(zip, draft, assetPaths);
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
  draft: BundleDraft,
  assetPaths: ReadonlyArray<ResolvedBundleAssetPaths>,
): void {
  const buffer = buildBundleProjectJsonBuffer(draft, assetPaths);
  zip.addBuffer(buffer, "project.json");
}

async function appendAllAssetEntriesToZip(
  zip: ZipFile,
  draft: BundleDraft,
  assetPaths: ReadonlyArray<ResolvedBundleAssetPaths>,
): Promise<void> {
  for (let i = 0; i < draft.viewports.length; i += 1) {
    await appendAssetEntriesForViewport(zip, draft.viewports[i]!, assetPaths[i]!);
  }
}

async function appendAssetEntriesForViewport(
  zip: ZipFile,
  viewport: BundleDraftViewportEntry,
  paths: ResolvedBundleAssetPaths,
): Promise<void> {
  if (viewport.asset.kind === "baked") {
    appendBakedAssetEntriesToZip(zip, viewport.asset, paths);
    return;
  }
  await appendExternalAssetEntriesToZip(zip, viewport.asset, paths);
}

async function appendExternalAssetEntriesToZip(
  zip: ZipFile,
  asset: BundleDraftExternalAsset,
  paths: ResolvedBundleAssetPaths,
): Promise<void> {
  zip.addFile(asset.absolutePath, paths.primaryRelativePath);
  await appendExternalEnviBinarySidecarIfPresent(zip, asset, paths);
}

async function appendExternalEnviBinarySidecarIfPresent(
  zip: ZipFile,
  asset: BundleDraftExternalAsset,
  paths: ResolvedBundleAssetPaths,
): Promise<void> {
  if (paths.sidecarRelativePath === null) return;
  const sidecarSourcePath = await findEnviBinarySiblingPathOrNull(asset.absolutePath);
  if (sidecarSourcePath === null) return;
  zip.addFile(sidecarSourcePath, paths.sidecarRelativePath);
}

function appendBakedAssetEntriesToZip(
  zip: ZipFile,
  asset: BundleDraftBakedAsset,
  paths: ResolvedBundleAssetPaths,
): void {
  zip.addBuffer(Buffer.from(asset.bytes), paths.primaryRelativePath);
  if (!asset.sidecar || !paths.sidecarRelativePath) return;
  zip.addBuffer(Buffer.from(asset.sidecar.bytes), paths.sidecarRelativePath);
}

function buildBundleProjectJsonBuffer(
  draft: BundleDraft,
  assetPaths: ReadonlyArray<ResolvedBundleAssetPaths>,
): Buffer {
  const data = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    gridLayout: draft.gridLayout,
    selectedViewportIndices: draft.selectedViewportIndices,
    viewports: draft.viewports.map((viewport, index) =>
      buildBundleViewportEntryWithRewrittenPath(viewport, assetPaths[index]!),
    ),
  };
  return Buffer.from(JSON.stringify(data, null, 2), "utf-8");
}

function buildBundleViewportEntryWithRewrittenPath(
  viewport: BundleDraftViewportEntry,
  paths: ResolvedBundleAssetPaths,
): unknown {
  return {
    index: viewport.index,
    source: {
      relativePath: paths.primaryRelativePath,
      fileName: viewport.fileName,
    },
    renderingState: viewport.renderingState,
    viewTransform: { zoom: 1, panX: 0, panY: 0 },
    operationHistory: viewport.operationHistory,
    roi: null,
  };
}
