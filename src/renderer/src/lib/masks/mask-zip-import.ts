import { buildImportedMaskLayerContent } from "@/lib/masks/mask-import";
import type { MaskLayerContent } from "@/lib/masks/mask-layer";
import {
  combineMaskFilesIntoOneLayer,
  type MaskFileToCombine,
} from "@/lib/masks/mask-multi-file-import";
import { decodeMaskPngBytes, type DecodedMaskPng } from "@/lib/masks/mask-png-decode";
import { parseMaskSidecarDocumentOrNull } from "@/lib/masks/mask-sidecar";
import type { ZipArchiveEntry } from "@/lib/masks/zip-store-reader";

// CT-328: a picked zip becomes one mask layer in one of two ways.
//
// LOSSLESS: the archive holds the toolbox's own pair, <name>.json beside
// <name>.png, so the layer is rebuilt from exactly those two and comes back
// with the name, category names, colours and opacity it was exported with. The
// per-category binaries sitting next to them are ignored, because the index
// PNG already says everything they say.
//
// PER-CATEGORY: any other zip is read as one black-and-white mask per .png
// entry, in entry-name order, exactly like picking those PNGs by hand.

export const ZIP_WITHOUT_MASK_PNGS_MESSAGE = "That zip holds no PNG mask files.";

const PNG_ENTRY_SUFFIX = ".png";
const SIDECAR_ENTRY_SUFFIX = ".json";

// The stack-coverage rule lives in the import flow, which knows the panel, so
// it is passed in rather than reached for.
export type RefuseMaskFileThatDoesNotCoverTheStack = (
  fileName: string,
  decoded: DecodedMaskPng,
) => void;

export interface LosslessMaskZipPair {
  readonly stem: string;
  readonly indexPngBytes: Uint8Array;
  readonly sidecarText: string;
}

export async function buildMaskLayerContentFromZipEntries(
  entries: ReadonlyArray<ZipArchiveEntry>,
  refuseMaskFile: RefuseMaskFileThatDoesNotCoverTheStack,
): Promise<MaskLayerContent> {
  const lossless = findLosslessMaskZipPairOrNull(entries);
  if (lossless !== null) return rebuildLayerFromIndexPngAndSidecar(lossless, refuseMaskFile);
  return buildLayerFromPerCategoryPngEntries(listMaskPngEntriesInNameOrder(entries), refuseMaskFile);
}

export function findLosslessMaskZipPairOrNull(
  entries: ReadonlyArray<ZipArchiveEntry>,
): LosslessMaskZipPair | null {
  for (const entry of entries) {
    const stem = readSidecarEntryStemOrNull(entry.name);
    const indexPng = stem === null ? undefined : findEntryNamedOrUndefined(entries, `${stem}${PNG_ENTRY_SUFFIX}`);
    if (stem !== null && indexPng !== undefined) {
      return { stem, indexPngBytes: indexPng.bytes, sidecarText: decodeEntryAsText(entry) };
    }
  }
  return null;
}

export function listMaskPngEntriesInNameOrder(
  entries: ReadonlyArray<ZipArchiveEntry>,
): ReadonlyArray<ZipArchiveEntry> {
  return entries
    .filter((entry) => entry.name.toLowerCase().endsWith(PNG_ENTRY_SUFFIX))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
}

function readSidecarEntryStemOrNull(entryName: string): string | null {
  if (!entryName.toLowerCase().endsWith(SIDECAR_ENTRY_SUFFIX)) return null;
  return entryName.slice(0, entryName.length - SIDECAR_ENTRY_SUFFIX.length);
}

function findEntryNamedOrUndefined(
  entries: ReadonlyArray<ZipArchiveEntry>,
  name: string,
): ZipArchiveEntry | undefined {
  return entries.find((entry) => entry.name === name);
}

function decodeEntryAsText(entry: ZipArchiveEntry): string {
  return new TextDecoder().decode(entry.bytes);
}

async function rebuildLayerFromIndexPngAndSidecar(
  pair: LosslessMaskZipPair,
  refuseMaskFile: RefuseMaskFileThatDoesNotCoverTheStack,
): Promise<MaskLayerContent> {
  const fileName = `${pair.stem}${PNG_ENTRY_SUFFIX}`;
  const decoded = await decodeMaskPngBytes(pair.indexPngBytes);
  refuseMaskFile(fileName, decoded);
  return buildImportedMaskLayerContent({
    fileName,
    decoded,
    sidecar: parseMaskSidecarDocumentOrNull(pair.sidecarText),
  });
}

async function buildLayerFromPerCategoryPngEntries(
  pngEntries: ReadonlyArray<ZipArchiveEntry>,
  refuseMaskFile: RefuseMaskFileThatDoesNotCoverTheStack,
): Promise<MaskLayerContent> {
  if (pngEntries.length === 0) throw new Error(ZIP_WITHOUT_MASK_PNGS_MESSAGE);
  const files = await Promise.all(pngEntries.map(decodeZipEntryAsMaskFile));
  files.forEach((file) => refuseMaskFile(file.fileName, file.decoded));
  return combineMaskFilesIntoOneLayer(files);
}

// A zip may nest its masks in a folder; the category is named after the file
// itself, not the path that led to it.
async function decodeZipEntryAsMaskFile(entry: ZipArchiveEntry): Promise<MaskFileToCombine> {
  return {
    fileName: readLastPathSegment(entry.name),
    decoded: await decodeMaskPngBytes(entry.bytes),
  };
}

function readLastPathSegment(entryName: string): string {
  const lastSeparator = entryName.lastIndexOf("/");
  return lastSeparator < 0 ? entryName : entryName.slice(lastSeparator + 1);
}
