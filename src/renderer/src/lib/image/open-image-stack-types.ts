import type { RasterImage } from "@/lib/image/raster-image";

export interface DecodedStackEntry {
  readonly fileName: string;
  readonly filePath: string;
  readonly fileSizeBytes: number;
  readonly mtimeMs: number;
  readonly raster: RasterImage | null;
  readonly decodeError: string | null;
  readonly wavelength: number | null;
  readonly differentiatingSubstring: string;
}

export type StackEntryValidationState =
  | { readonly kind: "valid" }
  | { readonly kind: "decode-failed"; readonly message: string }
  | { readonly kind: "multi-page"; readonly pageCount: number }
  | { readonly kind: "property-mismatch"; readonly propertyName: string; readonly message: string };
