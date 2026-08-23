import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open as openZipFile, type Entry, type ZipFile as ReadableZipFile } from "yauzl";
import { ZipFile } from "yazl";

// CT-306: a hand-built version 2 .ctbundle, so the "an older project still
// opens" assertion runs on a fixture the repo can carry (the reference bundle
// on the developer's machine is 1.6 GB and not committed). The manifest is the
// exact shape src/main/bundle-writer.ts wrote before masks existed: no masks
// array, no selectedMaskIndex.

const LEGACY_PROJECT_FILE_FORMAT_VERSION = 2;

export interface LegacyBundleViewport {
  readonly index: number;
  readonly fileName: string;
  readonly assetSourcePath: string;
  readonly assetExtension: string;
}

export async function writeLegacyVersionTwoBundle(
  viewports: ReadonlyArray<LegacyBundleViewport>,
): Promise<string> {
  const bundlePath = join(await createTemporaryLegacyBundleDirectory(), "legacy-v2.ctbundle");
  await writeBundleZipAtPath(bundlePath, viewports);
  return bundlePath;
}

async function createTemporaryLegacyBundleDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "msi-e2e-project-legacy-"));
}

function writeBundleZipAtPath(
  bundlePath: string,
  viewports: ReadonlyArray<LegacyBundleViewport>,
): Promise<void> {
  const zip = new ZipFile();
  const completion = pipeZipToFile(zip, bundlePath);
  zip.addBuffer(buildLegacyManifestBuffer(viewports), "project.json");
  viewports.forEach((viewport) =>
    zip.addFile(viewport.assetSourcePath, assetRelativePathOf(viewport)),
  );
  zip.end();
  return completion;
}

function pipeZipToFile(zip: ZipFile, bundlePath: string): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const writeStream = createWriteStream(bundlePath);
    writeStream.on("close", () => resolvePromise());
    writeStream.on("error", rejectPromise);
    zip.outputStream.on("error", rejectPromise);
    zip.outputStream.pipe(writeStream);
  });
}

function buildLegacyManifestBuffer(
  viewports: ReadonlyArray<LegacyBundleViewport>,
): Buffer {
  const manifest = {
    formatVersion: LEGACY_PROJECT_FILE_FORMAT_VERSION,
    gridLayout: "1x1",
    selectedViewportIndices: viewports.map((viewport) => viewport.index),
    viewports: viewports.map(buildLegacyManifestViewportEntry),
  };
  return Buffer.from(JSON.stringify(manifest, null, 2), "utf-8");
}

function buildLegacyManifestViewportEntry(viewport: LegacyBundleViewport): unknown {
  return {
    index: viewport.index,
    source: { relativePath: assetRelativePathOf(viewport), fileName: viewport.fileName },
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

function assetRelativePathOf(viewport: LegacyBundleViewport): string {
  return `assets/viewport-${viewport.index}.${viewport.assetExtension}`;
}

export interface BundleManifestSummary {
  readonly formatVersion: number;
  readonly viewports: ReadonlyArray<{
    readonly masks: ReadonlyArray<{ readonly relativePath: string }>;
    readonly selectedMaskIndex: number | null;
  }>;
}

export interface ReadBundleResult {
  readonly entryNames: ReadonlyArray<string>;
  readonly manifest: BundleManifestSummary;
}

// CT-306: reads a written .ctbundle without going through the app, so a spec
// can assert the ZIP entry NAMES the story pins as well as the manifest.
export async function readBundleEntriesAndManifest(
  bundlePath: string,
): Promise<ReadBundleResult> {
  const entries = await readEveryZipEntryAsText(bundlePath);
  const manifestText = entries.get("project.json");
  if (manifestText === undefined) throw new Error("The bundle has no project.json");
  return {
    entryNames: [...entries.keys()],
    manifest: JSON.parse(manifestText) as BundleManifestSummary,
  };
}

// Every entry is read, but only project.json's text is ever used; the rest are
// present so the caller can assert on the asset NAMES the bundle wrote.
function readEveryZipEntryAsText(bundlePath: string): Promise<Map<string, string>> {
  return new Promise((resolvePromise, rejectPromise) => {
    openZipFile(bundlePath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        rejectPromise(error ?? new Error("Failed to open bundle"));
        return;
      }
      collectEntriesFromOpenZip(zipFile, resolvePromise, rejectPromise);
    });
  });
}

function collectEntriesFromOpenZip(
  zipFile: ReadableZipFile,
  resolvePromise: (entries: Map<string, string>) => void,
  rejectPromise: (error: unknown) => void,
): void {
  const entries = new Map<string, string>();
  zipFile.on("end", () => resolvePromise(entries));
  zipFile.on("error", rejectPromise);
  zipFile.on("entry", (entry: Entry) => {
    readOneEntryText(zipFile, entry)
      .then((text) => {
        entries.set(entry.fileName, text);
        zipFile.readEntry();
      })
      .catch(rejectPromise);
  });
  zipFile.readEntry();
}

function readOneEntryText(zipFile: ReadableZipFile, entry: Entry): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    zipFile.openReadStream(entry, (error, readStream) => {
      if (error || !readStream) {
        rejectPromise(error ?? new Error("Failed to read a bundle entry"));
        return;
      }
      const chunks: Buffer[] = [];
      readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      readStream.on("error", rejectPromise);
      readStream.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf-8")));
    });
  });
}
