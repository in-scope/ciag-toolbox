import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Tracks which viewport is currently being asked to draw a region FOR an operation
 * (CT-095). This is the per-operation region-request path: while a viewport is the
 * requesting viewport, its region drawing feeds the operation's `operationRegion`
 * instead of the inspection ROI. Exactly one viewport can be requesting at a time.
 */
export interface RegionRequestApi {
  readonly requestingViewportIndex: number | null;
  readonly beginRegionRequest: (viewportIndex: number) => void;
  readonly endRegionRequest: () => void;
  readonly isRegionRequestActiveForViewport: (viewportIndex: number) => boolean;
}

const RegionRequestContext = createContext<RegionRequestApi | null>(null);

interface RegionRequestProviderProps {
  readonly children: ReactNode;
}

export function RegionRequestProvider({ children }: RegionRequestProviderProps): JSX.Element {
  const value = useRegionRequestInternalState();
  return <RegionRequestContext.Provider value={value}>{children}</RegionRequestContext.Provider>;
}

export function useRegionRequest(): RegionRequestApi {
  const value = useContext(RegionRequestContext);
  if (!value) {
    throw new Error("useRegionRequest must be used inside a RegionRequestProvider");
  }
  return value;
}

function useRegionRequestInternalState(): RegionRequestApi {
  const [requestingViewportIndex, setRequestingViewportIndex] = useState<number | null>(null);
  const beginRegionRequest = useCallback(
    (viewportIndex: number) => setRequestingViewportIndex(viewportIndex),
    [],
  );
  const endRegionRequest = useCallback(() => setRequestingViewportIndex(null), []);
  const isRegionRequestActiveForViewport = useCallback(
    (viewportIndex: number) => requestingViewportIndex === viewportIndex,
    [requestingViewportIndex],
  );
  return useMemo(
    () => ({
      requestingViewportIndex,
      beginRegionRequest,
      endRegionRequest,
      isRegionRequestActiveForViewport,
    }),
    [requestingViewportIndex, beginRegionRequest, endRegionRequest, isRegionRequestActiveForViewport],
  );
}
