import { compressBytesToZlibBytes } from "@/lib/compression/zlib-web-streams";
import {
  buildPngChunkBytes,
  concatenateByteArrays,
  PNG_SIGNATURE,
} from "@/lib/masks/png-chunks";

// CT-303: a mask layer exports as an 8-bit GRAYSCALE PNG whose pixel values
// ARE the category indexes (0 = unlabeled, 1..5 = the category's position), so
// the file drops straight into numpy/PIL without a palette lookup. Every
// scanline uses filter type 0 (None): the payload is tiny and unfiltered rows
// keep the exported bytes trivially readable by any decoder.

const PNG_BIT_DEPTH_EIGHT = 8;
const PNG_COLOR_TYPE_GRAYSCALE = 0;
const IHDR_CHUNK_DATA_BYTE_LENGTH = 13;

export async function encodeMaskValuesAsGrayscalePngBytes(
  width: number,
  height: number,
  values: Uint8Array,
): Promise<Uint8Array> {
  assertValuesCoverEveryPixel(width, height, values);
  const compressed = await compressBytesToZlibBytes(insertScanlineFilterBytes(width, values));
  return concatenateByteArrays([
    PNG_SIGNATURE,
    buildPngChunkBytes("IHDR", buildGrayscaleIhdrChunkData(width, height)),
    buildPngChunkBytes("IDAT", compressed),
    buildPngChunkBytes("IEND", new Uint8Array(0)),
  ]);
}

function assertValuesCoverEveryPixel(
  width: number,
  height: number,
  values: Uint8Array,
): void {
  if (width <= 0 || height <= 0 || values.length !== width * height) {
    throw new Error("The mask does not cover the described size.");
  }
}

function buildGrayscaleIhdrChunkData(width: number, height: number): Uint8Array {
  const data = new Uint8Array(IHDR_CHUNK_DATA_BYTE_LENGTH);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = PNG_BIT_DEPTH_EIGHT;
  data[9] = PNG_COLOR_TYPE_GRAYSCALE;
  return data;
}

function insertScanlineFilterBytes(width: number, values: Uint8Array): Uint8Array {
  const rowCount = values.length / width;
  const filtered = new Uint8Array(values.length + rowCount);
  for (let row = 0; row < rowCount; row += 1) {
    filtered[row * (width + 1)] = 0;
    filtered.set(values.subarray(row * width, (row + 1) * width), row * (width + 1) + 1);
  }
  return filtered;
}
