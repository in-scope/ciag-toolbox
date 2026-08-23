// Unit tests for the imported-script preparation: a .py becomes an inline script, a .zip
// is extracted to a temp package directory, and a .zip without a top-level main.py (or a
// wrong file type / an escaping entry) is rejected with a docs-linked error. These do not
// need the bundled interpreter; the worker-level "main.py defines run" check is covered by
// the integration suite in python-worker.test.ts.
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  IMPORTED_SCRIPT_DOCS_HINT,
  MAX_INLINE_USER_SCRIPT_SOURCE_BYTES,
  prepareImportedUserScriptFromFilePath,
  readSingleModuleUserScriptSource,
  resolveEntryDestinationWithinDirectory,
  ScriptImportError,
} from "./script-import";
import { writeZipArchiveWithEntries } from "./zip-archive-test-helper";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function makeTemporaryWorkingDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "msi-script-import-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writePythonFileWithSource(directory: string, source: string): Promise<string> {
  const filePath = path.join(directory, "tool.py");
  await fs.writeFile(filePath, source, "utf8");
  return filePath;
}

async function writeZipFileWithEntries(directory: string, entries: Record<string, string>): Promise<string> {
  const zipPath = path.join(directory, "tool.zip");
  await writeZipArchiveWithEntries(zipPath, entries);
  return zipPath;
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

describe("prepareImportedUserScriptFromFilePath", () => {
  it("reads a single .py file into an inline script input", async () => {
    const directory = await makeTemporaryWorkingDirectory();
    const source = "def run(cube, wavelengths=None):\n    return cube[0]\n";
    const prepared = await prepareImportedUserScriptFromFilePath(await writePythonFileWithSource(directory, source));
    expect(prepared.input).toEqual({ kind: "script", scriptSource: source });
    await prepared.releaseResources();
  });

  it("extracts a multi-module .zip into a package directory containing every entry", async () => {
    const directory = await makeTemporaryWorkingDirectory();
    const zipPath = await writeZipFileWithEntries(directory, {
      "main.py": "from combine import combine\n\n\ndef run(cube, wavelengths=None):\n    return combine(cube)\n",
      "combine.py": "def combine(cube):\n    return cube[0]\n",
    });
    const prepared = await prepareImportedUserScriptFromFilePath(zipPath);
    if (prepared.input.kind !== "package") throw new Error("expected a package input");
    expect(await pathExists(path.join(prepared.input.packageDirectory, "main.py"))).toBe(true);
    expect(await pathExists(path.join(prepared.input.packageDirectory, "combine.py"))).toBe(true);
    await prepared.releaseResources();
  });

  it("removes the extracted package directory when releaseResources is called", async () => {
    const directory = await makeTemporaryWorkingDirectory();
    const zipPath = await writeZipFileWithEntries(directory, { "main.py": "def run(cube):\n    return cube\n" });
    const prepared = await prepareImportedUserScriptFromFilePath(zipPath);
    if (prepared.input.kind !== "package") throw new Error("expected a package input");
    const packageDirectory = prepared.input.packageDirectory;
    await prepared.releaseResources();
    expect(await pathExists(packageDirectory)).toBe(false);
  });

  it("rejects a .zip without a top-level main.py with a docs-linked error", async () => {
    const directory = await makeTemporaryWorkingDirectory();
    const zipPath = await writeZipFileWithEntries(directory, { "helper.py": "def run(cube):\n    return cube\n" });
    await expect(prepareImportedUserScriptFromFilePath(zipPath)).rejects.toBeInstanceOf(ScriptImportError);
    await expect(prepareImportedUserScriptFromFilePath(zipPath)).rejects.toThrow(IMPORTED_SCRIPT_DOCS_HINT);
  });

  it("rejects a file that is neither .py nor .zip", async () => {
    const directory = await makeTemporaryWorkingDirectory();
    const filePath = path.join(directory, "tool.txt");
    await fs.writeFile(filePath, "not a tool", "utf8");
    await expect(prepareImportedUserScriptFromFilePath(filePath)).rejects.toBeInstanceOf(ScriptImportError);
  });

  it("keeps a normal entry name inside the extraction directory", () => {
    const root = path.join(tmpdir(), "extract-root");
    expect(resolveEntryDestinationWithinDirectory(root, "sub/main.py")).toBe(path.join(root, "sub", "main.py"));
  });

  it("rejects a .zip entry whose path escapes the extraction directory (zip-slip)", () => {
    const root = path.join(tmpdir(), "extract-root");
    expect(() => resolveEntryDestinationWithinDirectory(root, "../escape.py")).toThrow(ScriptImportError);
  });
});

// CT-310: the ROP search evaluates a custom objective per candidate inside its
// own Python run, so the renderer needs the script's SOURCE, not a prepared run.
describe("readSingleModuleUserScriptSource", () => {
  it("returns a .py file's source verbatim", async () => {
    const directory = await makeTemporaryWorkingDirectory();
    const filePath = await writePythonFileWithSource(directory, "def run(cube):\n    return 1\n");
    expect(await readSingleModuleUserScriptSource(filePath)).toBe("def run(cube):\n    return 1\n");
  });

  it("refuses a .zip tool, which has no single source to send", async () => {
    const directory = await makeTemporaryWorkingDirectory();
    const zipPath = await writeZipFileWithEntries(directory, { "main.py": "def run(cube):\n    return 1\n" });
    await expect(readSingleModuleUserScriptSource(zipPath)).rejects.toBeInstanceOf(ScriptImportError);
  });

  it("refuses a file too large to be a script, with the docs hint", async () => {
    const directory = await makeTemporaryWorkingDirectory();
    const filePath = await writePythonFileWithSource(
      directory,
      "#".repeat(MAX_INLINE_USER_SCRIPT_SOURCE_BYTES + 1),
    );
    await expect(readSingleModuleUserScriptSource(filePath)).rejects.toThrow(
      IMPORTED_SCRIPT_DOCS_HINT,
    );
  });
});
