import { concatenateByteArrays, sumByteLengths } from "@/lib/bytes/concatenate-byte-arrays";
import { computeCrc32OfBytes } from "@/lib/bytes/crc32";

// CT-327: exporting a mask layer writes ONE zip holding a black-and-white PNG
// per category next to the toolbox's own index PNG and JSON sidecar. The
// archive is built HERE, in the renderer, with no zip library: a STORE-only
// writer is a few hundred bytes of framing (PKZIP APPNOTE sections 4.3.7,
// 4.3.12 and 4.3.16), and the payloads are already-deflated PNGs that a second
// compression pass would only grow.
//
// Every entry is stored uncompressed, carries its CRC-32, and declares its name
// as UTF-8 through the general-purpose bit 11 flag, so a layer or category
// named in Greek or with an accent unzips with its name intact everywhere.

export interface ZipEntryToStore {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

const LOCAL_FILE_HEADER_BYTE_LENGTH = 30;
const CENTRAL_DIRECTORY_HEADER_BYTE_LENGTH = 46;
const END_OF_CENTRAL_DIRECTORY_BYTE_LENGTH = 22;

const ZIP_VERSION_TWO_POINT_ZERO = 20;
const STORE_COMPRESSION_METHOD = 0;
const UTF8_FILE_NAME_FLAG = 0x0800;

// The zip clock is MS-DOS, whose epoch is 1980-01-01 (day 1, month 1, year 0).
// A fixed timestamp keeps the same layer exporting to identical bytes.
const DOS_EPOCH_TIME_OF_DAY = 0;
const DOS_EPOCH_DATE = (1 << 5) | 1;

interface PreparedZipEntry {
  readonly nameBytes: Uint8Array;
  readonly bytes: Uint8Array;
  readonly checksum: number;
  readonly localHeaderOffset: number;
}

export function buildStoredZipArchiveBytes(
  entries: ReadonlyArray<ZipEntryToStore>,
): Uint8Array {
  const prepared = prepareEntriesWithTheirLocalHeaderOffsets(entries);
  const localSections = prepared.flatMap(buildLocalFileSectionParts);
  const centralHeaders = prepared.map(buildCentralDirectoryHeaderBytes);
  return concatenateByteArrays([
    ...localSections,
    ...centralHeaders,
    buildEndOfCentralDirectoryBytes(prepared.length, {
      byteLength: sumByteLengths(centralHeaders),
      offset: sumByteLengths(localSections),
    }),
  ]);
}

function prepareEntriesWithTheirLocalHeaderOffsets(
  entries: ReadonlyArray<ZipEntryToStore>,
): ReadonlyArray<PreparedZipEntry> {
  const encoder = new TextEncoder();
  let localHeaderOffset = 0;
  return entries.map((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const checksum = computeCrc32OfBytes(entry.bytes);
    const prepared = { nameBytes, bytes: entry.bytes, checksum, localHeaderOffset };
    localHeaderOffset +=
      LOCAL_FILE_HEADER_BYTE_LENGTH + nameBytes.byteLength + entry.bytes.byteLength;
    return prepared;
  });
}

function buildLocalFileSectionParts(entry: PreparedZipEntry): ReadonlyArray<Uint8Array> {
  return [buildLocalFileHeaderBytes(entry), entry.nameBytes, entry.bytes];
}

function buildLocalFileHeaderBytes(entry: PreparedZipEntry): Uint8Array {
  const header = new Uint8Array(LOCAL_FILE_HEADER_BYTE_LENGTH);
  const view = new DataView(header.buffer);
  view.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION_TWO_POINT_ZERO, true);
  writeSharedEntryFields(view, 6, entry);
  view.setUint16(26, entry.nameBytes.byteLength, true);
  return header;
}

function buildCentralDirectoryHeaderBytes(entry: PreparedZipEntry): Uint8Array {
  const header = new Uint8Array(
    CENTRAL_DIRECTORY_HEADER_BYTE_LENGTH + entry.nameBytes.byteLength,
  );
  const view = new DataView(header.buffer);
  view.setUint32(0, CENTRAL_DIRECTORY_HEADER_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION_TWO_POINT_ZERO, true);
  view.setUint16(6, ZIP_VERSION_TWO_POINT_ZERO, true);
  writeSharedEntryFields(view, 8, entry);
  view.setUint16(28, entry.nameBytes.byteLength, true);
  view.setUint32(42, entry.localHeaderOffset, true);
  header.set(entry.nameBytes, CENTRAL_DIRECTORY_HEADER_BYTE_LENGTH);
  return header;
}

// The flag, method, timestamp, checksum and size fields sit in the same order
// in both headers, so both write them through one routine at their own offset.
function writeSharedEntryFields(
  view: DataView,
  offset: number,
  entry: PreparedZipEntry,
): void {
  view.setUint16(offset, UTF8_FILE_NAME_FLAG, true);
  view.setUint16(offset + 2, STORE_COMPRESSION_METHOD, true);
  view.setUint16(offset + 4, DOS_EPOCH_TIME_OF_DAY, true);
  view.setUint16(offset + 6, DOS_EPOCH_DATE, true);
  view.setUint32(offset + 8, entry.checksum, true);
  view.setUint32(offset + 12, entry.bytes.byteLength, true);
  view.setUint32(offset + 16, entry.bytes.byteLength, true);
}

interface CentralDirectoryPlacement {
  readonly byteLength: number;
  readonly offset: number;
}

function buildEndOfCentralDirectoryBytes(
  entryCount: number,
  centralDirectory: CentralDirectoryPlacement,
): Uint8Array {
  const record = new Uint8Array(END_OF_CENTRAL_DIRECTORY_BYTE_LENGTH);
  const view = new DataView(record.buffer);
  view.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectory.byteLength, true);
  view.setUint32(16, centralDirectory.offset, true);
  return record;
}
