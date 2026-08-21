// CT-272: PNG file-header (signature + IHDR) sniffing, shared between the
// renderer open routing (which must know the bit depth BEFORE decoding, so a
// 16-bit PNG can bypass Chromium's silently-downscaling createImageBitmap
// path) and the main-process 16-bit decoder (png16-decode.ts), which parses
// the same fields while walking the file's chunks.

export interface PngFileHeaderSummary {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlaceMethod: number;
}

export const INTERLACED_PNG_REFUSAL_MESSAGE =
  "Interlaced PNGs are not supported; re-export without interlacing";

export const PNG16_ALPHA_UNSUPPORTED_MESSAGE =
  "16-bit PNGs with an alpha channel are not supported. Re-export without the alpha channel.";

const PNG_SIGNATURE: ReadonlyArray<number> = [137, 80, 78, 71, 13, 10, 26, 10];
const IHDR_CHUNK_DATA_BYTE_LENGTH = 13;
const IHDR_DATA_OFFSET_IN_FILE = 16;
const MINIMUM_SNIFFABLE_BYTE_LENGTH = IHDR_DATA_OFFSET_IN_FILE + IHDR_CHUNK_DATA_BYTE_LENGTH;

const PNG_COLOR_TYPE_GRAYSCALE = 0;
const PNG_COLOR_TYPE_RGB = 2;
const PNG_COLOR_TYPE_GRAYSCALE_ALPHA = 4;
const PNG_COLOR_TYPE_RGB_ALPHA = 6;

export function parsePngFileHeaderOrNull(bytes: Uint8Array): PngFileHeaderSummary | null {
  if (bytes.length < MINIMUM_SNIFFABLE_BYTE_LENGTH) return null;
  if (!startsWithPngSignature(bytes)) return null;
  if (!firstChunkIsWellFormedIhdr(bytes)) return null;
  return parseIhdrChunkData(bytes.subarray(IHDR_DATA_OFFSET_IN_FILE));
}

export function startsWithPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((expected, index) => bytes[index] === expected);
}

// The IHDR chunk's 13 data bytes: width, height (both big-endian uint32),
// then bit depth, color type, compression, filter, and interlace method.
export function parseIhdrChunkData(data: Uint8Array): PngFileHeaderSummary {
  if (data.length < IHDR_CHUNK_DATA_BYTE_LENGTH) {
    throw new Error("The PNG file's IHDR chunk is truncated");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    width: view.getUint32(0),
    height: view.getUint32(4),
    bitDepth: data[8]!,
    colorType: data[9]!,
    interlaceMethod: data[12]!,
  };
}

export function isSixteenBitPngFileHeader(
  summary: PngFileHeaderSummary | null,
): summary is PngFileHeaderSummary {
  return summary !== null && summary.bitDepth === 16;
}

export function channelCountForSixteenBitPngColorTypeOrThrow(colorType: number): number {
  if (colorType === PNG_COLOR_TYPE_GRAYSCALE) return 1;
  if (colorType === PNG_COLOR_TYPE_RGB) return 3;
  if (colorType === PNG_COLOR_TYPE_GRAYSCALE_ALPHA || colorType === PNG_COLOR_TYPE_RGB_ALPHA) {
    throw new Error(PNG16_ALPHA_UNSUPPORTED_MESSAGE);
  }
  throw new Error(`16-bit PNGs with color type ${colorType} are not supported`);
}

// The one gate both processes use before attempting a 16-bit decode: throws
// the locked user-facing refusals for interlacing and unsupported color types.
export function assertSixteenBitPngHeaderIsDecodable(summary: PngFileHeaderSummary): void {
  if (summary.interlaceMethod !== 0) throw new Error(INTERLACED_PNG_REFUSAL_MESSAGE);
  channelCountForSixteenBitPngColorTypeOrThrow(summary.colorType);
}

function firstChunkIsWellFormedIhdr(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstChunkDataLength = view.getUint32(8);
  return firstChunkDataLength === IHDR_CHUNK_DATA_BYTE_LENGTH && readsAsIhdrChunkType(bytes);
}

function readsAsIhdrChunkType(bytes: Uint8Array): boolean {
  return String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) === "IHDR";
}
