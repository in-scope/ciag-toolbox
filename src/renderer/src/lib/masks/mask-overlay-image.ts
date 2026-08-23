import { UNLABELED_MASK_VALUE, type MaskCategory } from "@/lib/masks/mask-layer";

// CT-304: the selected layer's DISPLAY form. Every labeled pixel takes its
// category's colour at the layer opacity and every unlabeled pixel stays fully
// transparent, so the image underneath shows through untouched. This is display
// only: the mask values and the stack's pixel data are never changed by it.

export interface MaskOverlayColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface MaskOverlayImageInputs {
  readonly values: Uint8Array;
  readonly categories: ReadonlyArray<MaskCategory>;
  readonly opacityPercent: number;
}

const OPAQUE_ALPHA = 255;
const BYTES_PER_RGBA_PIXEL = 4;
const FALLBACK_OVERLAY_COLOR: MaskOverlayColor = Object.freeze({ red: 0, green: 0, blue: 0 });

// The ArrayBuffer type argument is explicit so the result drops straight into
// an ImageData (TS 5.7 typed ArrayBuffers reject the ArrayBufferLike default).
export function buildMaskOverlayRgbaBytes(
  inputs: MaskOverlayImageInputs,
): Uint8ClampedArray<ArrayBuffer> {
  const bytes = new Uint8ClampedArray(inputs.values.length * BYTES_PER_RGBA_PIXEL);
  const alpha = convertOpacityPercentToAlpha(inputs.opacityPercent);
  for (let pixel = 0; pixel < inputs.values.length; pixel += 1) {
    writeOverlayPixel(bytes, pixel, inputs.values[pixel] ?? UNLABELED_MASK_VALUE, inputs, alpha);
  }
  return bytes;
}

function writeOverlayPixel(
  bytes: Uint8ClampedArray<ArrayBuffer>,
  pixel: number,
  value: number,
  inputs: MaskOverlayImageInputs,
  alpha: number,
): void {
  const color = resolveMaskOverlayColorOrNull(value, inputs.categories);
  if (!color) return;
  const offset = pixel * BYTES_PER_RGBA_PIXEL;
  bytes[offset] = color.red;
  bytes[offset + 1] = color.green;
  bytes[offset + 2] = color.blue;
  bytes[offset + 3] = alpha;
}

// An unlabeled pixel, or one whose category was deleted out from under it,
// contributes nothing to the overlay.
export function resolveMaskOverlayColorOrNull(
  value: number,
  categories: ReadonlyArray<MaskCategory>,
): MaskOverlayColor | null {
  if (value === UNLABELED_MASK_VALUE) return null;
  const category = categories[value - 1];
  if (!category) return null;
  return parseHexColorOrNull(category.color) ?? FALLBACK_OVERLAY_COLOR;
}

export function convertOpacityPercentToAlpha(opacityPercent: number): number {
  if (!Number.isFinite(opacityPercent)) return OPAQUE_ALPHA;
  const clamped = Math.min(100, Math.max(0, opacityPercent));
  return Math.round((clamped / 100) * OPAQUE_ALPHA);
}

// Accepts the two hex forms an <input type="color"> and a mask sidecar can
// carry: #rgb and #rrggbb.
export function parseHexColorOrNull(color: string): MaskOverlayColor | null {
  const digits = expandShorthandHexDigitsOrNull(color.trim());
  if (!digits) return null;
  return {
    red: Number.parseInt(digits.slice(0, 2), 16),
    green: Number.parseInt(digits.slice(2, 4), 16),
    blue: Number.parseInt(digits.slice(4, 6), 16),
  };
}

function expandShorthandHexDigitsOrNull(color: string): string | null {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.slice(1);
  if (!/^#[0-9a-fA-F]{3}$/.test(color)) return null;
  return [...color.slice(1)].map((digit) => `${digit}${digit}`).join("");
}
