import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ToneCurveChannelPreviewLuts } from "@/lib/image/tone-curve-composite-preview";

// CT-171/CT-177: holds the transient display-only tone-curve LUT preview for a
// single viewport. App computes the display-normalized lookup table(s) from the
// active tool's live anchors and publishes them here; each viewport cell reads
// back its own LUT and uploads it to the GPU instead of re-baking the band into a
// new raster. A scientific stack / single-band photo publishes a single LUT
// (ViewportRenderer.setToneCurveLookupTable); a true-colour composite publishes
// per-channel LUTs (setToneCurveChannelLookupTables). The preview never touches
// the committed image, so apply/cancel simply clears it (-> shader bypass).

export interface ToneCurveLutPreview {
  readonly viewportIndex: number;
  readonly lookupTable: ReadonlyArray<number> | null;
  readonly channelLookupTables: ToneCurveChannelPreviewLuts | null;
}

export interface ToneCurvePreviewApi {
  readonly setPreview: (preview: ToneCurveLutPreview | null) => void;
  readonly getLookupTableForViewport: (viewportIndex: number) => ReadonlyArray<number> | null;
  readonly getChannelLookupTablesForViewport: (
    viewportIndex: number,
  ) => ToneCurveChannelPreviewLuts | null;
}

const ToneCurvePreviewContext = createContext<ToneCurvePreviewApi | null>(null);

interface ToneCurvePreviewProviderProps {
  readonly children: ReactNode;
}

export function ToneCurvePreviewProvider({ children }: ToneCurvePreviewProviderProps): JSX.Element {
  const value = useToneCurvePreviewInternalState();
  return (
    <ToneCurvePreviewContext.Provider value={value}>{children}</ToneCurvePreviewContext.Provider>
  );
}

export function useToneCurvePreview(): ToneCurvePreviewApi {
  const value = useContext(ToneCurvePreviewContext);
  if (!value) {
    throw new Error("useToneCurvePreview must be used inside a ToneCurvePreviewProvider");
  }
  return value;
}

function useToneCurvePreviewInternalState(): ToneCurvePreviewApi {
  const [preview, setPreview] = useState<ToneCurveLutPreview | null>(null);
  const getLookupTableForViewport = useCallback(
    (viewportIndex: number) =>
      previewForViewportOrNull(preview, viewportIndex)?.lookupTable ?? null,
    [preview],
  );
  const getChannelLookupTablesForViewport = useCallback(
    (viewportIndex: number) =>
      previewForViewportOrNull(preview, viewportIndex)?.channelLookupTables ?? null,
    [preview],
  );
  return useMemo(
    () => ({ setPreview, getLookupTableForViewport, getChannelLookupTablesForViewport }),
    [setPreview, getLookupTableForViewport, getChannelLookupTablesForViewport],
  );
}

function previewForViewportOrNull(
  preview: ToneCurveLutPreview | null,
  viewportIndex: number,
): ToneCurveLutPreview | null {
  return preview && preview.viewportIndex === viewportIndex ? preview : null;
}
