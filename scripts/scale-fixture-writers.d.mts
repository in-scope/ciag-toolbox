// Type surface for scale-fixture-writers.mjs so the Vitest round-trip test
// (src/renderer/src/lib/image/scale10-fixture-writers.test.ts) typechecks.

export interface ScaleFixtureCaptureSpec {
  readonly width: number;
  readonly height: number;
  readonly bandCount: number;
  readonly bandBase: (bandIndex: number) => number;
}

export type EmitFixtureBytes = (bytes: Uint8Array) => void;

export interface EnviWriteByteCounts {
  readonly headerByteCount: number;
  readonly binaryByteCount: number;
}

export interface ManifestSamplePixel {
  readonly x: number;
  readonly y: number;
  readonly valuesPerBand: ReadonlyArray<number>;
}

export interface ManifestCaptureDescription {
  readonly width: number;
  readonly height: number;
  readonly bandCount: number;
  readonly dataType: string;
  readonly bandBases: ReadonlyArray<number>;
  readonly bandMeans: ReadonlyArray<number>;
  readonly samplePixels: ReadonlyArray<ManifestSamplePixel>;
}

export declare const PIXEL_RAMP_MODULUS: number;

export declare function computeOraclePixelValue(
  spec: ScaleFixtureCaptureSpec,
  bandIndex: number,
  x: number,
  y: number,
): number;

export declare function computeOracleBandMean(
  spec: ScaleFixtureCaptureSpec,
  bandIndex: number,
): number;

export declare function buildBandSamples(
  spec: ScaleFixtureCaptureSpec,
  bandIndex: number,
): Uint16Array;

export declare function writeMultiPageUint16Tiff(
  filePath: string,
  spec: ScaleFixtureCaptureSpec,
): number;

export declare function emitMultiPageUint16TiffBytes(
  spec: ScaleFixtureCaptureSpec,
  emitBytes: EmitFixtureBytes,
): void;

export declare function buildEnviBsqUint16HeaderText(
  spec: ScaleFixtureCaptureSpec,
): string;

export declare function writeEnviBsqUint16(
  headerPath: string,
  binaryPath: string,
  spec: ScaleFixtureCaptureSpec,
): EnviWriteByteCounts;

export declare function emitEnviBsqUint16BinaryBytes(
  spec: ScaleFixtureCaptureSpec,
  emitBytes: EmitFixtureBytes,
): void;

export declare function describeCaptureForManifest(
  spec: ScaleFixtureCaptureSpec,
): ManifestCaptureDescription;
