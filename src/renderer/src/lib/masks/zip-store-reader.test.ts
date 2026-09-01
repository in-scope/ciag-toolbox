import { describe, expect, it } from "vitest";
import yazl from "yazl";

import {
  NOT_A_ZIP_ARCHIVE_MESSAGE,
  readZipArchiveEntries,
  UNSUPPORTED_ZIP_COMPRESSION_MESSAGE,
} from "@/lib/masks/zip-store-reader";
import { buildStoredZipArchiveBytes } from "@/lib/masks/zip-store-writer";

// CT-328: the renderer reads a picked mask zip with no zip library. The
// oracles are the app's OWN writer (a STORE archive must round-trip) and yazl
// (a real DEFLATE archive from a third-party tool must read the same), with
// yazl confined to this test file - it never reaches the renderer bundle.

const TEXT_ENCODER = new TextEncoder();

function encodeText(text: string): Uint8Array {
  return TEXT_ENCODER.encode(text);
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

interface EntryToZip {
  readonly name: string;
  readonly bytes: Uint8Array;
}

// yazl deflates by default, so this is the "written by another tool" archive.
function buildDeflatedZipWithYazl(entries: ReadonlyArray<EntryToZip>): Promise<Uint8Array> {
  const archive = new yazl.ZipFile();
  entries.forEach((entry) => archive.addBuffer(Buffer.from(entry.bytes), entry.name));
  archive.end();
  return collectStreamBytes(archive.outputStream);
}

function collectStreamBytes(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    stream.on("error", reject);
  });
}

const SAMPLE_ENTRIES: ReadonlyArray<EntryToZip> = [
  { name: "Parchment.png", bytes: Uint8Array.from([1, 2, 3, 4, 5]) },
  { name: "Parchment mask.json", bytes: encodeText('{"formatVersion":1}') },
];

describe("readZipArchiveEntries", () => {
  it("round-trips the stored archive the exporter writes", async () => {
    const archive = buildStoredZipArchiveBytes(SAMPLE_ENTRIES);

    const entries = await readZipArchiveEntries(archive);

    expect(entries.map((entry) => entry.name)).toEqual([
      "Parchment.png",
      "Parchment mask.json",
    ]);
    expect(Array.from(entries[0]!.bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(decodeText(entries[1]!.bytes)).toBe('{"formatVersion":1}');
  });

  it("reads a deflated archive written by another tool", async () => {
    const payload = encodeText("compress me".repeat(64));
    const archive = await buildDeflatedZipWithYazl([{ name: "nested/mask.png", bytes: payload }]);

    const entries = await readZipArchiveEntries(archive);

    expect(entries.map((entry) => entry.name)).toEqual(["nested/mask.png"]);
    expect(decodeText(entries[0]!.bytes)).toBe(decodeText(payload));
  });

  it("keeps a non-ASCII entry name intact", async () => {
    const archive = buildStoredZipArchiveBytes([
      { name: "Pergamènt μάσκα.png", bytes: Uint8Array.from([9]) },
    ]);

    const entries = await readZipArchiveEntries(archive);

    expect(entries.map((entry) => entry.name)).toEqual(["Pergamènt μάσκα.png"]);
  });

  it("reads an empty archive as no entries", async () => {
    expect(await readZipArchiveEntries(buildStoredZipArchiveBytes([]))).toEqual([]);
  });

  it("refuses bytes that hold no end-of-central-directory record", async () => {
    await expect(readZipArchiveEntries(Uint8Array.from([137, 80, 78, 71]))).rejects.toThrow(
      NOT_A_ZIP_ARCHIVE_MESSAGE,
    );
  });

  it("refuses an entry stored with a compression method it cannot read", async () => {
    const archive = buildStoredZipArchiveBytes(SAMPLE_ENTRIES);

    await expect(
      readZipArchiveEntries(replaceEveryCompressionMethod(archive, 12)),
    ).rejects.toThrow(UNSUPPORTED_ZIP_COMPRESSION_MESSAGE);
  });
});

// The method sits at offset 8 of a local header and offset 10 of a central
// directory header; only the central one is read back, so rewriting it is
// enough to stand in for a BZIP2 archive.
function replaceEveryCompressionMethod(archive: Uint8Array, method: number): Uint8Array {
  const rewritten = archive.slice();
  const view = new DataView(rewritten.buffer);
  for (let offset = 0; offset + 12 <= rewritten.byteLength; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) view.setUint16(offset + 10, method, true);
  }
  return rewritten;
}
