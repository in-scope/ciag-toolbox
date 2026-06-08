import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-086: holds the transient live false-color preview for a single viewport.
// ApplicationShell computes the preview RGBA source from the active tool's live
// band selections and publishes it here; each viewport cell reads back the
// preview for its own index and renders it instead of the committed source. The
// preview never touches the committed image, so apply/cancel simply clears it.

export interface FalseColorPreview {
  readonly viewportIndex: number;
  readonly source: ViewportImageSource;
}

export interface FalseColorPreviewApi {
  readonly setPreview: (preview: FalseColorPreview | null) => void;
  readonly getPreviewSourceForViewport: (viewportIndex: number) => ViewportImageSource | null;
}

const FalseColorPreviewContext = createContext<FalseColorPreviewApi | null>(null);

interface FalseColorPreviewProviderProps {
  readonly children: ReactNode;
}

export function FalseColorPreviewProvider({ children }: FalseColorPreviewProviderProps): JSX.Element {
  const value = useFalseColorPreviewInternalState();
  return (
    <FalseColorPreviewContext.Provider value={value}>{children}</FalseColorPreviewContext.Provider>
  );
}

export function useFalseColorPreview(): FalseColorPreviewApi {
  const value = useContext(FalseColorPreviewContext);
  if (!value) {
    throw new Error("useFalseColorPreview must be used inside a FalseColorPreviewProvider");
  }
  return value;
}

function useFalseColorPreviewInternalState(): FalseColorPreviewApi {
  const [preview, setPreview] = useState<FalseColorPreview | null>(null);
  const getPreviewSourceForViewport = useCallback(
    (viewportIndex: number) =>
      preview && preview.viewportIndex === viewportIndex ? preview.source : null,
    [preview],
  );
  return useMemo(
    () => ({ setPreview, getPreviewSourceForViewport }),
    [setPreview, getPreviewSourceForViewport],
  );
}
