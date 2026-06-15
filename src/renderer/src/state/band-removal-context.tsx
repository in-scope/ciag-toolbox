import { createContext, useContext, type ReactNode } from "react";

export interface ViewportBandRemovalApi {
  readonly removeBand: (viewportIndex: number, bandIndex: number) => void;
}

const NOOP_BAND_REMOVAL_API: ViewportBandRemovalApi = {
  removeBand: () => undefined,
};

const ViewportBandRemovalContext = createContext<ViewportBandRemovalApi>(NOOP_BAND_REMOVAL_API);

interface ViewportBandRemovalProviderProps {
  value: ViewportBandRemovalApi;
  children: ReactNode;
}

export function ViewportBandRemovalProvider(
  props: ViewportBandRemovalProviderProps,
): JSX.Element {
  return (
    <ViewportBandRemovalContext.Provider value={props.value}>
      {props.children}
    </ViewportBandRemovalContext.Provider>
  );
}

export function useViewportBandRemoval(): ViewportBandRemovalApi {
  return useContext(ViewportBandRemovalContext);
}
