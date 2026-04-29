import { createContext, useContext, type ReactNode } from "react";

export interface ViewportDuplicationApi {
  hasSourceContent: (sourceIndex: number) => boolean;
  requestDuplicate: (sourceIndex: number) => void;
}

const ViewportDuplicationContext = createContext<ViewportDuplicationApi | null>(null);

interface ViewportDuplicationProviderProps {
  value: ViewportDuplicationApi;
  children: ReactNode;
}

export function ViewportDuplicationProvider({
  value,
  children,
}: ViewportDuplicationProviderProps): JSX.Element {
  return (
    <ViewportDuplicationContext.Provider value={value}>
      {children}
    </ViewportDuplicationContext.Provider>
  );
}

export function useViewportDuplication(): ViewportDuplicationApi {
  const value = useContext(ViewportDuplicationContext);
  if (!value) {
    throw new Error("useViewportDuplication must be used inside a ViewportDuplicationProvider");
  }
  return value;
}
