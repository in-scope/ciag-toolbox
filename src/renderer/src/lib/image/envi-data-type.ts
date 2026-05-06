import type {
  RasterSampleFormat,
  RasterTypedArray,
} from "@/lib/image/raster-image";

export const ENVI_DATA_TYPE_BYTE = 1;
export const ENVI_DATA_TYPE_INT16 = 2;
export const ENVI_DATA_TYPE_INT32 = 3;
export const ENVI_DATA_TYPE_FLOAT32 = 4;
export const ENVI_DATA_TYPE_FLOAT64 = 5;
export const ENVI_DATA_TYPE_COMPLEX_FLOAT32 = 6;
export const ENVI_DATA_TYPE_COMPLEX_FLOAT64 = 9;
export const ENVI_DATA_TYPE_UINT16 = 12;
export const ENVI_DATA_TYPE_UINT32 = 13;
export const ENVI_DATA_TYPE_INT64 = 14;
export const ENVI_DATA_TYPE_UINT64 = 15;

export interface EnviDataTypeDescriptor {
  readonly bytesPerSample: number;
  readonly bitsPerSample: number;
  readonly sampleFormat: RasterSampleFormat;
  readonly readSampleAtByteOffset: ReadEnviSampleFunction;
  readonly allocateBandTypedArray: AllocateBandTypedArrayFunction;
}

export type ReadEnviSampleFunction = (
  view: DataView,
  byteOffset: number,
  isLittleEndian: boolean,
) => number;

export type AllocateBandTypedArrayFunction = (length: number) => RasterTypedArray;

export function describeSupportedEnviDataTypeOrThrow(
  dataType: number,
): EnviDataTypeDescriptor {
  rejectUnsupportedEnviDataType(dataType);
  return SUPPORTED_ENVI_DATA_TYPE_DESCRIPTORS.get(dataType)!;
}

function rejectUnsupportedEnviDataType(dataType: number): void {
  rejectComplexEnviDataType(dataType);
  rejectDoublePrecisionEnviDataType(dataType);
  rejectSixtyFourBitIntegerEnviDataType(dataType);
  if (!SUPPORTED_ENVI_DATA_TYPE_DESCRIPTORS.has(dataType)) {
    throw new Error(`Unsupported ENVI data type code: ${dataType}`);
  }
}

function rejectComplexEnviDataType(dataType: number): void {
  if (dataType === ENVI_DATA_TYPE_COMPLEX_FLOAT32) {
    throw new Error("Complex float32 ENVI cubes are not supported");
  }
  if (dataType === ENVI_DATA_TYPE_COMPLEX_FLOAT64) {
    throw new Error("Complex float64 ENVI cubes are not supported");
  }
}

function rejectDoublePrecisionEnviDataType(dataType: number): void {
  if (dataType === ENVI_DATA_TYPE_FLOAT64) {
    throw new Error("Double-precision float ENVI cubes are not supported");
  }
}

function rejectSixtyFourBitIntegerEnviDataType(dataType: number): void {
  if (dataType === ENVI_DATA_TYPE_INT64) {
    throw new Error("64-bit signed integer ENVI cubes are not supported");
  }
  if (dataType === ENVI_DATA_TYPE_UINT64) {
    throw new Error("64-bit unsigned integer ENVI cubes are not supported");
  }
}

const SUPPORTED_ENVI_DATA_TYPE_DESCRIPTORS = new Map<number, EnviDataTypeDescriptor>([
  [
    ENVI_DATA_TYPE_BYTE,
    {
      bytesPerSample: 1,
      bitsPerSample: 8,
      sampleFormat: "uint",
      readSampleAtByteOffset: (view, offset) => view.getUint8(offset),
      allocateBandTypedArray: (length) => new Uint8Array(length),
    },
  ],
  [
    ENVI_DATA_TYPE_INT16,
    {
      bytesPerSample: 2,
      bitsPerSample: 16,
      sampleFormat: "int",
      readSampleAtByteOffset: (view, offset, le) => view.getInt16(offset, le),
      allocateBandTypedArray: (length) => new Int16Array(length),
    },
  ],
  [
    ENVI_DATA_TYPE_INT32,
    {
      bytesPerSample: 4,
      bitsPerSample: 32,
      sampleFormat: "int",
      readSampleAtByteOffset: (view, offset, le) => view.getInt32(offset, le),
      allocateBandTypedArray: (length) => new Int32Array(length),
    },
  ],
  [
    ENVI_DATA_TYPE_FLOAT32,
    {
      bytesPerSample: 4,
      bitsPerSample: 32,
      sampleFormat: "float",
      readSampleAtByteOffset: (view, offset, le) => view.getFloat32(offset, le),
      allocateBandTypedArray: (length) => new Float32Array(length),
    },
  ],
  [
    ENVI_DATA_TYPE_UINT16,
    {
      bytesPerSample: 2,
      bitsPerSample: 16,
      sampleFormat: "uint",
      readSampleAtByteOffset: (view, offset, le) => view.getUint16(offset, le),
      allocateBandTypedArray: (length) => new Uint16Array(length),
    },
  ],
  [
    ENVI_DATA_TYPE_UINT32,
    {
      bytesPerSample: 4,
      bitsPerSample: 32,
      sampleFormat: "uint",
      readSampleAtByteOffset: (view, offset, le) => view.getUint32(offset, le),
      allocateBandTypedArray: (length) => new Uint32Array(length),
    },
  ],
]);
