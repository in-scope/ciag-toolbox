import { createContext, useContext, type ReactNode } from "react";

export interface ViewportReimportApi {
  readonly requestReimport: (viewportIndex: number) => void;
}

const NOOP_REIMPORT_API: ViewportReimportApi = {
  requestReimport: () => undefined,
};

const ViewportReimportContext = createContext<ViewportReimportApi>(NOOP_REIMPORT_API);

interface ViewportReimportProviderProps {
  value: ViewportReimportApi;
  children: ReactNode;
}

export function ViewportReimportProvider(
  props: ViewportReimportProviderProps,
): JSX.Element {
  return (
    <ViewportReimportContext.Provider value={props.value}>
      {props.children}
    </ViewportReimportContext.Provider>
  );
}

export function useViewportReimport(): ViewportReimportApi {
  return useContext(ViewportReimportContext);
}
