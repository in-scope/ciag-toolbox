import type { DraftBundleAsset, DraftBundleFile } from "./serialize-project";

// CT-219e: the renderer-side draft still bakes asset bytes in memory, but they
// must never cross IPC inside one payload (the whole-draft invoke killed the
// renderer at reference scale; see src/shared/chunked-save-bundle-protocol.ts).
// This split turns a draft into the byte-free header the begin request carries
// plus the list of baked parts whose bytes upload afterwards as chunks.

export interface SaveBundleUploadPart {
  readonly viewportIndex: number;
  readonly part: ToolboxSaveBundleAssetPart;
  readonly bytes: Uint8Array;
}

export interface SplitDraftBundle {
  readonly header: ToolboxSaveBundleDraftHeader;
  readonly parts: ReadonlyArray<SaveBundleUploadPart>;
}

export function splitDraftBundleForChunkedSave(draft: DraftBundleFile): SplitDraftBundle {
  const parts: SaveBundleUploadPart[] = [];
  const viewports = draft.viewports.map((viewport) => ({
    index: viewport.index,
    fileName: viewport.fileName,
    asset: describeAssetCollectingUploadParts(viewport.asset, viewport.index, parts),
    renderingState: viewport.renderingState,
    operationHistory: viewport.operationHistory,
    ...(viewport.colorInterpretation === "rgb" ? { colorInterpretation: "rgb" as const } : {}),
  }));
  return { header: buildHeaderFromDraft(draft, viewports), parts };
}

function buildHeaderFromDraft(
  draft: DraftBundleFile,
  viewports: ReadonlyArray<ToolboxSaveBundleViewportHeaderEntry>,
): ToolboxSaveBundleDraftHeader {
  return {
    formatVersion: draft.formatVersion,
    gridLayout: draft.gridLayout,
    selectedViewportIndices: draft.selectedViewportIndices,
    viewports,
  };
}

function describeAssetCollectingUploadParts(
  asset: DraftBundleAsset,
  viewportIndex: number,
  parts: SaveBundleUploadPart[],
): ToolboxSaveBundleAssetDescriptor {
  if (asset.kind === "external") return asset;
  parts.push({ viewportIndex, part: "primary", bytes: asset.bytes });
  if (asset.sidecar) parts.push({ viewportIndex, part: "sidecar", bytes: asset.sidecar.bytes });
  return {
    kind: "baked",
    primary: { extension: asset.extension, byteLength: asset.bytes.byteLength },
    ...(asset.sidecar
      ? {
          sidecar: {
            extension: asset.sidecar.extension,
            byteLength: asset.sidecar.bytes.byteLength,
          },
        }
      : {}),
  };
}
