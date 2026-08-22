import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const EIGHT_BIT_DEPTH = 8;
const GRAYSCALE_COLOR_TYPE = 0;
const crc32Table = buildCrc32Table();

export interface GrayscalePngFixture {
  readonly width: number;
  readonly height: number;
  readonly pixelRows: ReadonlyArray<ReadonlyArray<number>>;
}

const DEFAULT_GRAYSCALE_PNG_FIXTURE: GrayscalePngFixture = {
  width: 2,
  height: 2,
  pixelRows: [
    [10, 240],
    [120, 60],
  ],
};

export async function writeTemporaryGrayscalePngFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msi-e2e-"));
  const filePath = join(directory, "stub-fixture.png");
  await writeFile(filePath, encodeGrayscalePng(DEFAULT_GRAYSCALE_PNG_FIXTURE));
  return filePath;
}

// CT-263: two 4x4 uniform-value grayscale PNG variants sized to match the
// committed low-contrast-gray.png fixture, so a trio of grayscale PNGs can
// combine into one 3-band stack with a distinct known value per band. The
// names avoid 3-4 digit runs so the wavelength parser never orders them.
export interface GrayscalePngVariantFixtureFile {
  readonly filePath: string;
  readonly fileName: string;
  readonly uniformValue: number;
}

const GRAYSCALE_VARIANT_SIDE = 4;
const GRAYSCALE_VARIANT_FILES: ReadonlyArray<Pick<GrayscalePngVariantFixtureFile, "fileName" | "uniformValue">> = [
  { fileName: "gray-uniform-b.png", uniformValue: 30 },
  { fileName: "gray-uniform-c.png", uniformValue: 220 },
];

export async function writeTemporaryGrayscalePngVariantFixtures(): Promise<
  ReadonlyArray<GrayscalePngVariantFixtureFile>
> {
  const directory = await mkdtemp(join(tmpdir(), "msi-e2e-"));
  return Promise.all(
    GRAYSCALE_VARIANT_FILES.map((file) => writeUniformGrayscaleVariantFile(directory, file)),
  );
}

async function writeUniformGrayscaleVariantFile(
  directory: string,
  file: Pick<GrayscalePngVariantFixtureFile, "fileName" | "uniformValue">,
): Promise<GrayscalePngVariantFixtureFile> {
  const filePath = join(directory, file.fileName);
  await writeFile(filePath, encodeGrayscalePng(buildUniformGrayscaleFixture(file.uniformValue)));
  return { filePath, fileName: file.fileName, uniformValue: file.uniformValue };
}

function buildUniformGrayscaleFixture(uniformValue: number): GrayscalePngFixture {
  const row = Array.from({ length: GRAYSCALE_VARIANT_SIDE }, () => uniformValue);
  return {
    width: GRAYSCALE_VARIANT_SIDE,
    height: GRAYSCALE_VARIANT_SIDE,
    pixelRows: Array.from({ length: GRAYSCALE_VARIANT_SIDE }, () => row),
  };
}

function encodeGrayscalePng(fixture: GrayscalePngFixture): Buffer {
  const headerChunk = encodePngChunk("IHDR", buildGrayscaleHeaderData(fixture));
  const dataChunk = encodePngChunk("IDAT", deflateSync(buildRawScanlines(fixture.pixelRows)));
  const endChunk = encodePngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([PNG_SIGNATURE, headerChunk, dataChunk, endChunk]);
}

function buildGrayscaleHeaderData(fixture: GrayscalePngFixture): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(fixture.width, 0);
  data.writeUInt32BE(fixture.height, 4);
  data[8] = EIGHT_BIT_DEPTH;
  data[9] = GRAYSCALE_COLOR_TYPE;
  return data;
}

function buildRawScanlines(
  pixelRows: ReadonlyArray<ReadonlyArray<number>>,
): Buffer {
  const scanlines = pixelRows.map((row) => Buffer.from([0, ...row]));
  return Buffer.concat(scanlines);
}

function encodePngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = buildUint32BigEndianBuffer(data.length);
  const checksum = buildUint32BigEndianBuffer(computeCrc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

function buildUint32BigEndianBuffer(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function computeCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    table[index] = computeCrc32TableEntry(index);
  }
  return table;
}

function computeCrc32TableEntry(byteValue: number): number {
  let remainder = byteValue;
  for (let bit = 0; bit < 8; bit += 1) {
    remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1;
  }
  return remainder >>> 0;
}
