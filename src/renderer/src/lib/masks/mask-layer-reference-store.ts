import type { MaskLayer } from "@/lib/masks/mask-layer";

// CT-313: a "mask-layer" parameter field can only carry a STRING token
// (ParameterValuesById is number | string | boolean, never a Uint8Array), so
// the ACTUAL MaskLayer the user picked - its painted pixel values - has to be
// resolved synchronously at Apply time from somewhere outside the parameter
// values. This mirrors pick-reference-raster.ts's token -> raster resolution,
// but for mask layers: the field writes every currently-qualifying layer in
// here as it renders (a plain replace-all sync, keyed by layer id - the panel
// only ever needs the ACTIVE panel's own qualifying layers while it is open,
// so there is no cross-panel eviction to manage), and the action's
// transformSourceAsync reads the CHOSEN layer back out by id.

const rememberedMaskLayersById = new Map<string, MaskLayer>();

export function syncRememberedMaskLayers(layers: ReadonlyArray<MaskLayer>): void {
  rememberedMaskLayersById.clear();
  for (const layer of layers) rememberedMaskLayersById.set(layer.id, layer);
}

export function readRememberedMaskLayerOrNull(layerId: string): MaskLayer | null {
  return rememberedMaskLayersById.get(layerId) ?? null;
}
