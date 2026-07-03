// Prepares a user-imported tool for the worker: a single .py file becomes an inline
// script, and a multi-module .zip is extracted to a temp directory whose top-level
// main.py becomes a package the worker imports. Only the user's Python runs as Python;
// reading, extracting, validating the entry, and cleanup all live here in TS/Node.
import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

import type { UserScriptInput } from "./worker-protocol";

export const IMPORTED_SCRIPT_DOCS_HINT =
  "See the 'How to write a custom script' page for the expected tool format.";

// Rejections a user can fix (wrong file type, a .zip with no top-level main.py) carry the
// docs hint so the message points at the format they need.
export class ScriptImportError extends Error {
  constructor(problem: string) {
    super(`${problem} ${IMPORTED_SCRIPT_DOCS_HINT}`);
    this.name = "ScriptImportError";
  }
}

// The prepared run plus a handle to release any temp directory the import created; the
// caller invokes releaseResources once the worker has finished with it.
export interface PreparedImportedScript {
  input: UserScriptInput;
  releaseResources: () => Promise<void>;
}

export async function prepareImportedUserScriptFromFilePath(
  filePath: string,
): Promise<PreparedImportedScript> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".py") return prepareSingleModuleScriptFromFile(filePath);
  if (extension === ".zip") return prepareMultiModulePackageFromZipArchive(filePath);
  throw new ScriptImportError("An imported tool must be a single .py file or a .zip archive.");
}

async function prepareSingleModuleScriptFromFile(filePath: string): Promise<PreparedImportedScript> {
  const scriptSource = await fs.readFile(filePath, "utf8");
  return { input: { kind: "script", scriptSource }, releaseResources: releaseNothing };
}

async function prepareMultiModulePackageFromZipArchive(
  zipPath: string,
): Promise<PreparedImportedScript> {
  const packageDirectory = await createUniqueTemporaryExtractionDirectory();
  try {
    await extractZipArchiveIntoDirectory(zipPath, packageDirectory);
    await assertPackageDefinesTopLevelMainEntry(packageDirectory);
  } catch (error) {
    await removeDirectoryTree(packageDirectory);
    throw error;
  }
  return { input: { kind: "package", packageDirectory }, releaseResources: () => removeDirectoryTree(packageDirectory) };
}

async function assertPackageDefinesTopLevelMainEntry(packageDirectory: string): Promise<void> {
  if (await fileExists(path.join(packageDirectory, "main.py"))) return;
  throw new ScriptImportError(
    "A .zip tool must contain a top-level main.py that defines run(cube, wavelengths=None).",
  );
}

async function extractZipArchiveIntoDirectory(zipPath: string, targetDirectory: string): Promise<void> {
  const archive = await openZipArchiveForReading(zipPath);
  await drainZipEntriesIntoDirectory(archive, targetDirectory);
}

function openZipArchiveForReading(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, archive) => {
      if (error || !archive) reject(error ?? new ScriptImportError("The .zip archive could not be opened."));
      else resolve(archive);
    });
  });
}

function drainZipEntriesIntoDirectory(archive: yauzl.ZipFile, targetDirectory: string): Promise<void> {
  return new Promise((resolve, reject) => {
    archive.on("entry", (entry: yauzl.Entry) => {
      extractSingleZipEntry(archive, entry, targetDirectory).then(() => archive.readEntry(), reject);
    });
    archive.on("end", resolve);
    archive.on("error", reject);
    archive.readEntry();
  });
}

async function extractSingleZipEntry(
  archive: yauzl.ZipFile,
  entry: yauzl.Entry,
  targetDirectory: string,
): Promise<void> {
  const destinationPath = resolveEntryDestinationWithinDirectory(targetDirectory, entry.fileName);
  if (entryNameIsDirectory(entry.fileName)) {
    await fs.mkdir(destinationPath, { recursive: true });
    return;
  }
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await writeZipEntryStreamToFile(archive, entry, destinationPath);
}

function writeZipEntryStreamToFile(
  archive: yauzl.ZipFile,
  entry: yauzl.Entry,
  destinationPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    archive.openReadStream(entry, (error, readStream) => {
      if (error || !readStream) reject(error ?? new ScriptImportError("A .zip entry could not be read."));
      else pipeline(readStream, createWriteStream(destinationPath)).then(resolve, reject);
    });
  });
}

// Guards against zip-slip: an entry whose path resolves outside the extraction directory
// is rejected rather than allowed to write over an arbitrary file. Exported so the guard
// is unit-testable without hand-crafting a malicious archive.
export function resolveEntryDestinationWithinDirectory(targetDirectory: string, entryName: string): string {
  const root = path.resolve(targetDirectory);
  const destinationPath = path.resolve(root, entryName);
  if (destinationPath !== root && !destinationPath.startsWith(root + path.sep)) {
    throw new ScriptImportError("The .zip archive contains an entry that escapes the tool directory.");
  }
  return destinationPath;
}

function entryNameIsDirectory(entryName: string): boolean {
  return entryName.endsWith("/");
}

function createUniqueTemporaryExtractionDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), "msi-imported-tool-"));
}

function removeDirectoryTree(directory: string): Promise<void> {
  return fs.rm(directory, { recursive: true, force: true });
}

async function fileExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function releaseNothing(): Promise<void> {
  return Promise.resolve();
}
