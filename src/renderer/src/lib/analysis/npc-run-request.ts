import type { MaskLayer } from "@/lib/masks/mask-layer";
import type { UserScriptRunExtras } from "@/lib/python/run-user-script-chunked";

import { listNonEmptyCategoryValuesInMaskLayer } from "./npc-qualification";

// CT-308: assembles what the built-in npc.py run needs beyond the cube - one
// binary mask per NON-EMPTY category (the script asserts an empty mask) and the
// bins parameter. Empty categories are skipped rather than refused so a layer
// with a spare unused category still scores its painted ones.

export const DEFAULT_NPC_BIN_COUNT = 255;
export const MIN_NPC_BIN_COUNT = 2;

export function clampNpcBinCount(bins: number): number {
  if (!Number.isFinite(bins)) return DEFAULT_NPC_BIN_COUNT;
  return Math.max(MIN_NPC_BIN_COUNT, Math.trunc(bins));
}

// The panel keeps the Bins field as typed text so a half-typed number is not
// rewritten under the cursor; null means "not a usable bin count yet" and
// blocks Compute.
export function parseNpcBinCountOrNull(binsText: string): number | null {
  const trimmed = binsText.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= MIN_NPC_BIN_COUNT ? parsed : null;
}

export function buildNpcCategoryMasks(layer: MaskLayer): Uint8Array[] {
  return listNonEmptyCategoryValuesInMaskLayer(layer).map((categoryValue) =>
    selectPixelsPaintedWithCategoryValue(layer.values, categoryValue),
  );
}

function selectPixelsPaintedWithCategoryValue(
  values: Uint8Array,
  categoryValue: number,
): Uint8Array {
  const selected = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    selected[index] = values[index] === categoryValue ? 1 : 0;
  }
  return selected;
}

export function buildNpcRunExtras(layer: MaskLayer, bins: number): UserScriptRunExtras {
  return {
    masks: buildNpcCategoryMasks(layer),
    params: { bins: clampNpcBinCount(bins) },
  };
}
