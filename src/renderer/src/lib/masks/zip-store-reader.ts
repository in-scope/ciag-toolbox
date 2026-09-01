import { decompressRawDeflateBytes } from "@/lib/compression/zlib-web-streams";

// CT-328: reads an imported mask zip back to its entries. The renderer still
// carries no zip library (yazl/yauzl stay Node-only), so the archive is parsed
// the way it is written in zip-store-writer.ts: locate the end-of-central-
// directory record, walk the central directory, and slice each entry's payload
// out of its local file section.
//
// STORE (the method this app writes) and DEFLATE (what every other zip tool
// writes) are both read; a DEFLATE entry is RAW deflate, so it inflates
// through DecompressionStream("deflate-raw").

export interface ZipArchiveEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export const NOT_A_ZIP_ARCHIVE_MESSAGE =
  "That file is not a zip archive. Choose a PNG mask file or a mask zip.";

export const UNSUPPORTED_ZIP_COMPRESSION_MESSAGE =
  "That zip uses a compression method this app cannot read. Re-create it as a stored or deflated zip.";

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

const END_OF_CENTRAL_DIRECTORY_BYTE_LENGTH = 22;
const CENTRAL_DIRECTORY_HEADER_BYTE_LENGTH = 46;
const LOCAL_FILE_HEADER_BYTE_LENGTH = 30;

const STORE_COMPRESSION_METHOD = 0;
const DEFLATE_COMPRESSION_METHOD = 8;

// The record ends with a comment whose length field is 16 bits, so the
// signature can sit at most that far from the end of the file.
const MAX_END_OF_CENTRAL_DIRECTORY_COMMENT_BYTES = 0xffff;

interface CentralDirectoryPlacement {
  readonly entryCount: number;
  readonly offset: number;
}

interface CentralDirectoryEntry {
  readonly name: string;
  readonly compressionMethod: number;
  readonly compressedByteLength: number;
  readonly localHeaderOffset: number;
}

export async function readZipArchiveEntries(
  archiveBytes: Uint8Array,
): Promise<ReadonlyArray<ZipArchiveEntry>> {
  const view = viewOverBytes(archiveBytes);
  const directory = readCentralDirectoryPlacementOrThrow(view);
  const described = describeEveryCentralDirectoryEntry(archiveBytes, view, directory);
  return Promise.all(described.map((entry) => readOneEntryPayload(archiveBytes, view, entry)));
}

function viewOverBytes(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readCentralDirectoryPlacementOrThrow(view: DataView): CentralDirectoryPlacement {
  const recordOffset = findEndOfCentralDirectoryOffsetOrThrow(view);
  return {
    entryCount: view.getUint16(recordOffset + 10, true),
    offset: view.getUint32(recordOffset + 16, true),
  };
}

// The signature is searched from the end because the record is the last thing
// in the file apart from an optional trailing comment.
function findEndOfCentralDirectoryOffsetOrThrow(view: DataView): number {
  const lastPossible = view.byteLength - END_OF_CENTRAL_DIRECTORY_BYTE_LENGTH;
  const firstPossible = Math.max(0, lastPossible - MAX_END_OF_CENTRAL_DIRECTORY_COMMENT_BYTES);
  for (let offset = lastPossible; offset >= firstPossible; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new Error(NOT_A_ZIP_ARCHIVE_MESSAGE);
}

function describeEveryCentralDirectoryEntry(
  archiveBytes: Uint8Array,
  view: DataView,
  directory: CentralDirectoryPlacement,
): ReadonlyArray<CentralDirectoryEntry> {
  const entries: CentralDirectoryEntry[] = [];
  let offset = directory.offset;
  while (entries.length < directory.entryCount) {
    entries.push(readCentralDirectoryEntryAtOrThrow(archiveBytes, view, offset));
    offset += measureCentralDirectoryHeaderByteLength(view, offset);
  }
  return entries;
}

function readCentralDirectoryEntryAtOrThrow(
  archiveBytes: Uint8Array,
  view: DataView,
  offset: number,
): CentralDirectoryEntry {
  if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
    throw new Error(NOT_A_ZIP_ARCHIVE_MESSAGE);
  }
  return {
    name: readEntryNameAt(archiveBytes, offset + CENTRAL_DIRECTORY_HEADER_BYTE_LENGTH, view.getUint16(offset + 28, true)),
    compressionMethod: view.getUint16(offset + 10, true),
    compressedByteLength: view.getUint32(offset + 20, true),
    localHeaderOffset: view.getUint32(offset + 42, true),
  };
}

// Name, extra field and comment all follow the fixed header, each with its own
// 16-bit length, so the next header sits past all four.
function measureCentralDirectoryHeaderByteLength(view: DataView, offset: number): number {
  return (
    CENTRAL_DIRECTORY_HEADER_BYTE_LENGTH +
    view.getUint16(offset + 28, true) +
    view.getUint16(offset + 30, true) +
    view.getUint16(offset + 32, true)
  );
}

function readEntryNameAt(archiveBytes: Uint8Array, offset: number, byteLength: number): string {
  return new TextDecoder().decode(archiveBytes.subarray(offset, offset + byteLength));
}

async function readOneEntryPayload(
  archiveBytes: Uint8Array,
  view: DataView,
  entry: CentralDirectoryEntry,
): Promise<ZipArchiveEntry> {
  const stored = sliceStoredPayloadOfEntryOrThrow(archiveBytes, view, entry);
  return { name: entry.name, bytes: await expandStoredPayloadOrThrow(stored, entry) };
}

// The local header repeats the name and may carry a DIFFERENT extra field from
// the central one, so the payload's start is measured from the local header
// itself; its length comes from the central directory, which is correct even
// when the local header defers its sizes to a data descriptor.
function sliceStoredPayloadOfEntryOrThrow(
  archiveBytes: Uint8Array,
  view: DataView,
  entry: CentralDirectoryEntry,
): Uint8Array {
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(NOT_A_ZIP_ARCHIVE_MESSAGE);
  }
  const payloadOffset =
    offset +
    LOCAL_FILE_HEADER_BYTE_LENGTH +
    view.getUint16(offset + 26, true) +
    view.getUint16(offset + 28, true);
  return archiveBytes.subarray(payloadOffset, payloadOffset + entry.compressedByteLength);
}

async function expandStoredPayloadOrThrow(
  storedBytes: Uint8Array,
  entry: CentralDirectoryEntry,
): Promise<Uint8Array> {
  if (entry.compressionMethod === STORE_COMPRESSION_METHOD) return storedBytes;
  if (entry.compressionMethod === DEFLATE_COMPRESSION_METHOD) {
    return decompressRawDeflateBytes(storedBytes);
  }
  throw new Error(UNSUPPORTED_ZIP_COMPRESSION_MESSAGE);
}
