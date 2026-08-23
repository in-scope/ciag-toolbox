import { emitBufferInBoundedSlicesInOrder } from "@/lib/image/emit-byte-chunks";
import type { BundleAssetPartEncodingPlan } from "@/lib/image/encode-bundle-asset";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import type { MaskPanelState } from "@/lib/masks/mask-panel";
import { encodeMaskValuesAsGrayscalePngBytes } from "@/lib/masks/mask-png-encode";

import {
  describeMaskLayerForManifest,
  type MaskLayerManifestFields,
} from "./project-mask-layers";

// CT-306: a mask layer is packed into the bundle as the same 8-bit PNG the
// CT-303 export writes, so a mask lifted out of a .ctbundle by hand opens in
// numpy or PIL unchanged. Unlike a baked stack, a mask PNG is encoded WHOLE
// before the header is sent: the chunked save protocol needs each part's exact
// byte length up front and a deflated length cannot be predicted. That is safe
// because a mask holds one byte per pixel, an order of magnitude below the
// multi-band cube it annotates.

export const MASK_BUNDLE_ASSET_EXTENSION = "png";

export interface DraftBundleMaskLayer extends MaskLayerManifestFields {
  readonly plan: BundleAssetPartEncodingPlan;
}

export async function planMaskBundleAssetsForPanel(
  panel: MaskPanelState,
): Promise<ReadonlyArray<DraftBundleMaskLayer>> {
  const planned: DraftBundleMaskLayer[] = [];
  for (const layer of panel.layers) {
    planned.push(await planMaskBundleAssetForLayer(layer));
  }
  return planned;
}

async function planMaskBundleAssetForLayer(layer: MaskLayer): Promise<DraftBundleMaskLayer> {
  const pngBytes = await encodeMaskValuesAsGrayscalePngBytes(
    layer.width,
    layer.height,
    layer.values,
  );
  return { ...describeMaskLayerForManifest(layer), plan: buildEncodedPngUploadPlan(pngBytes) };
}

function buildEncodedPngUploadPlan(pngBytes: Uint8Array): BundleAssetPartEncodingPlan {
  return {
    extension: MASK_BUNDLE_ASSET_EXTENSION,
    byteLength: pngBytes.byteLength,
    emitChunksInOrder: (maxChunkBytes, onChunk) =>
      emitBufferInBoundedSlicesInOrder(pngBytes, maxChunkBytes, onChunk),
  };
}
