import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// CT-171: holds the transient display-only tone-curve LUT preview for a single
// viewport. App computes the display-normalized lookup table from the active
// tool's live anchors and publishes it here; each viewport cell reads back its
// own LUT and uploads it to the GPU (ViewportRenderer.setToneCurveLookupTable)
// instead of re-baking the band into a new raster. The preview never touches the
// committed image, so apply/cancel simply clears it (LUT -> null -> shader bypass).

export interface ToneCurveLutPreview {
  readonly viewportIndex: number;
  readonly lookupTable: ReadonlyArray<number>;
}

export interface ToneCurvePreviewApi {
  readonly setPreview: (preview: ToneCurveLutPreview | null) => void;
  readonly getLookupTableForViewport: (viewportIndex: number) => ReadonlyArray<number> | null;
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
      preview && preview.viewportIndex === viewportIndex ? preview.lookupTable : null,
    [preview],
  );
  return useMemo(
    () => ({ setPreview, getLookupTableForViewport }),
    [setPreview, getLookupTableForViewport],
  );
}
