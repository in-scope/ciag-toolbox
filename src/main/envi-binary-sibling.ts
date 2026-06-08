import { readdir } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

const ENVI_HEADER_EXTENSION = ".hdr";

const ENVI_BINARY_EXTENSION_CANDIDATES: ReadonlyArray<string> = [
  ".bin",
  ".dat",
  ".img",
  ".raw",
  "",
];

export function isEnviHeaderFilePath(filePath: string): boolean {
  return extname(filePath).toLowerCase() === ENVI_HEADER_EXTENSION;
}

export async function findEnviBinarySiblingPathOrNull(
  headerPath: string,
): Promise<string | null> {
  const directoryEntries = await readDirectoryEntriesOrEmpty(dirname(headerPath));
  const matchingEntry = pickEnviBinarySiblingFromDirectoryEntries(headerPath, directoryEntries);
  if (!matchingEntry) return null;
  return join(dirname(headerPath), matchingEntry);
}

async function readDirectoryEntriesOrEmpty(
  directoryPath: string,
): Promise<ReadonlyArray<string>> {
  try {
    return await readdir(directoryPath);
  } catch {
    return [];
  }
}

function pickEnviBinarySiblingFromDirectoryEntries(
  headerPath: string,
  directoryEntries: ReadonlyArray<string>,
): string | undefined {
  const headerBaseNameLower = basename(headerPath, extname(headerPath)).toLowerCase();
  for (const candidate of ENVI_BINARY_EXTENSION_CANDIDATES) {
    const match = pickFirstMatchingDirectoryEntry(
      directoryEntries,
      headerBaseNameLower,
      candidate,
    );
    if (match) return match;
  }
  return undefined;
}

function pickFirstMatchingDirectoryEntry(
  entries: ReadonlyArray<string>,
  baseNameLower: string,
  expectedExtensionLower: string,
): string | undefined {
  return entries.find((entry) =>
    entryMatchesBaseNameAndExtension(entry, baseNameLower, expectedExtensionLower),
  );
}

function entryMatchesBaseNameAndExtension(
  entry: string,
  baseNameLower: string,
  expectedExtensionLower: string,
): boolean {
  const entryLower = entry.toLowerCase();
  if (expectedExtensionLower === "") return entryLower === baseNameLower;
  return entryLower === baseNameLower + expectedExtensionLower;
}
