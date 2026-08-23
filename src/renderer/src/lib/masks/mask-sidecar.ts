import {
  DEFAULT_MASK_LAYER_OPACITY_PERCENT,
  type MaskCategory,
  type MaskLayer,
} from "@/lib/masks/mask-layer";

// CT-303: the JSON file written next to an exported mask PNG. The PNG alone
// carries only the category INDEXES; the sidecar names and colours them so a
// re-import restores the layer the user built. It is optional on import: a
// mask produced by someone's own tool has no sidecar, and the indexes present
// in the PNG get default names and colours instead.

export const MASK_SIDECAR_FORMAT_VERSION = 1;
export const MASK_SIDECAR_FILE_EXTENSION = "json";

export interface MaskSidecarCategory {
  readonly index: number;
  readonly name: string;
  readonly color: string;
}

export interface MaskSidecarDocument {
  readonly formatVersion: number;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly categories: ReadonlyArray<MaskSidecarCategory>;
  // The overlay opacity as a PERCENT (0..100), the same unit the Masks aside
  // shows and MaskLayer.opacityPercent stores.
  readonly opacity: number;
}

export function buildMaskSidecarDocument(layer: MaskLayer): MaskSidecarDocument {
  return {
    formatVersion: MASK_SIDECAR_FORMAT_VERSION,
    name: layer.name,
    width: layer.width,
    height: layer.height,
    categories: layer.categories.map(describeCategoryAtPosition),
    opacity: layer.opacityPercent,
  };
}

function describeCategoryAtPosition(
  category: MaskCategory,
  position: number,
): MaskSidecarCategory {
  return { index: position + 1, name: category.name, color: category.color };
}

export function serializeMaskSidecarDocument(layer: MaskLayer): string {
  return `${JSON.stringify(buildMaskSidecarDocument(layer), null, 2)}\n`;
}

// An unreadable or malformed sidecar reads as ABSENT rather than failing the
// import: the PNG is the mask, the sidecar is only its labelling.
export function parseMaskSidecarDocumentOrNull(text: string): MaskSidecarDocument | null {
  const parsed = parseJsonObjectOrNull(text);
  if (parsed === null || parsed["formatVersion"] !== MASK_SIDECAR_FORMAT_VERSION) return null;
  const categories = parseSidecarCategoriesOrNull(parsed["categories"]);
  if (categories === null) return null;
  return buildDocumentFromParsedFields(parsed, categories);
}

function buildDocumentFromParsedFields(
  parsed: Record<string, unknown>,
  categories: ReadonlyArray<MaskSidecarCategory>,
): MaskSidecarDocument | null {
  const name = parsed["name"];
  if (typeof name !== "string" || name.length === 0) return null;
  return {
    formatVersion: MASK_SIDECAR_FORMAT_VERSION,
    name,
    width: readPositiveIntegerOrZero(parsed["width"]),
    height: readPositiveIntegerOrZero(parsed["height"]),
    categories,
    opacity: readOpacityPercentOrDefault(parsed["opacity"]),
  };
}

function parseJsonObjectOrNull(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSidecarCategoriesOrNull(
  value: unknown,
): ReadonlyArray<MaskSidecarCategory> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const categories = value.map(parseSidecarCategoryOrNull);
  return categories.every((category) => category !== null)
    ? (categories as ReadonlyArray<MaskSidecarCategory>)
    : null;
}

function parseSidecarCategoryOrNull(value: unknown): MaskSidecarCategory | null {
  if (!isPlainObject(value)) return null;
  const index = value["index"];
  const name = value["name"];
  const color = value["color"];
  if (!Number.isInteger(index) || (index as number) < 1) return null;
  if (typeof name !== "string" || !isHexColorText(color)) return null;
  return { index: index as number, name, color: color as string };
}

function isHexColorText(value: unknown): boolean {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function readPositiveIntegerOrZero(value: unknown): number {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : 0;
}

function readOpacityPercentOrDefault(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MASK_LAYER_OPACITY_PERCENT;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}
