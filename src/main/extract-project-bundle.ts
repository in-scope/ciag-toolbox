import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { open as openZipFile, type Entry, type ZipFile } from "yauzl";

const TEMP_BUNDLE_DIRECTORY_PREFIX = "ctbundle-";

export async function extractProjectBundleToFreshTempDirectory(
  bundleFilePath: string,
): Promise<string> {
  const tempDirectory = await createUniqueTempDirectoryForBundle();
  await streamAllBundleEntriesIntoDirectory(bundleFilePath, tempDirectory);
  return tempDirectory;
}

async function createUniqueTempDirectoryForBundle(): Promise<string> {
  return mkdtemp(join(tmpdir(), TEMP_BUNDLE_DIRECTORY_PREFIX));
}

function streamAllBundleEntriesIntoDirectory(
  bundleFilePath: string,
  targetDirectory: string,
): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    openZipFile(bundleFilePath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        rejectPromise(error ?? new Error("Failed to open bundle"));
        return;
      }
      attachZipExtractionLifecycleHandlers(
        zipFile,
        targetDirectory,
        resolvePromise,
        rejectPromise,
      );
      zipFile.readEntry();
    });
  });
}

function attachZipExtractionLifecycleHandlers(
  zipFile: ZipFile,
  targetDirectory: string,
  resolveExtraction: () => void,
  rejectExtraction: (err: unknown) => void,
): void {
  zipFile.on("end", () => resolveExtraction());
  zipFile.on("error", (err) => rejectExtraction(err));
  zipFile.on("entry", (entry: Entry) =>
    handleSingleZipEntry(zipFile, entry, targetDirectory, rejectExtraction),
  );
}

function handleSingleZipEntry(
  zipFile: ZipFile,
  entry: Entry,
  targetDirectory: string,
  rejectExtraction: (err: unknown) => void,
): void {
  if (isDirectoryZipEntry(entry)) {
    zipFile.readEntry();
    return;
  }
  extractFileEntryAndContinue(zipFile, entry, targetDirectory).catch(rejectExtraction);
}

async function extractFileEntryAndContinue(
  zipFile: ZipFile,
  entry: Entry,
  targetDirectory: string,
): Promise<void> {
  await extractSingleFileEntryToDirectory(zipFile, entry, targetDirectory);
  zipFile.readEntry();
}

function isDirectoryZipEntry(entry: Entry): boolean {
  return /\/$/.test(entry.fileName);
}

async function extractSingleFileEntryToDirectory(
  zipFile: ZipFile,
  entry: Entry,
  targetDirectory: string,
): Promise<void> {
  const safeOutputPath = resolveSafeOutputPathForZipEntry(targetDirectory, entry.fileName);
  await mkdir(dirname(safeOutputPath), { recursive: true });
  await streamZipEntryToOutputFile(zipFile, entry, safeOutputPath);
}

function resolveSafeOutputPathForZipEntry(
  targetDirectory: string,
  zipEntryFileName: string,
): string {
  const normalizedTarget = resolve(targetDirectory, zipEntryFileName);
  const normalizedRoot = resolve(targetDirectory);
  if (
    normalizedTarget !== normalizedRoot &&
    !normalizedTarget.startsWith(normalizedRoot + sep)
  ) {
    throw new Error(`Refusing to extract zip entry outside target directory: ${zipEntryFileName}`);
  }
  return normalizedTarget;
}

function streamZipEntryToOutputFile(
  zipFile: ZipFile,
  entry: Entry,
  outputPath: string,
): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    zipFile.openReadStream(entry, (error, readStream) => {
      if (error || !readStream) {
        rejectPromise(error ?? new Error("Failed to open zip entry stream"));
        return;
      }
      pipeZipEntryReadStreamToFile(readStream, outputPath, resolvePromise, rejectPromise);
    });
  });
}

function pipeZipEntryReadStreamToFile(
  readStream: NodeJS.ReadableStream,
  outputPath: string,
  resolveStream: () => void,
  rejectStream: (err: unknown) => void,
): void {
  const writeStream = createWriteStream(outputPath);
  let settled = false;
  const settle = (action: () => void): void => {
    if (settled) return;
    settled = true;
    action();
  };
  writeStream.on("close", () => settle(resolveStream));
  writeStream.on("error", (err) => settle(() => rejectStream(err)));
  readStream.on("error", (err) => settle(() => rejectStream(err)));
  readStream.pipe(writeStream);
}
