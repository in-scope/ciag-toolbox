// Type surface for png-utils.mjs so TS unit tests can exercise the PNG builders.

export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export declare const PLACEHOLDER_BACKGROUND_COLOR: RgbaColor;

export declare function buildRgbaPng(
  width: number,
  height: number,
  rgbaPixelBuffer: Uint8Array,
): Uint8Array;

export declare function buildSolidColorPng(
  width: number,
  height: number,
  color: RgbaColor,
): Uint8Array;

export declare function streamRgbaPngUsingRowProvider(
  width: number,
  height: number,
  provideRowRgba: (y: number) => Uint8Array,
  emitPngBytes: (bytes: Uint8Array) => void | Promise<void>,
): Promise<void>;
