import { createContext, useContext, type ReactNode } from "react";

export interface ViewportClosingApi {
  // CT-269: closable = holds an image OR is the reserved (still empty) target
  // of an in-flight apply, whose close cancels that run.
  canClose: (index: number) => boolean;
  closeViewport: (index: number) => void;
}

const ViewportClosingContext = createContext<ViewportClosingApi | null>(null);

interface ViewportClosingProviderProps {
  value: ViewportClosingApi;
  children: ReactNode;
}

export function ViewportClosingProvider({
  value,
  children,
}: ViewportClosingProviderProps): JSX.Element {
  return (
    <ViewportClosingContext.Provider value={value}>{children}</ViewportClosingContext.Provider>
  );
}

export function useViewportClosing(): ViewportClosingApi {
  const value = useContext(ViewportClosingContext);
  if (!value) {
    throw new Error("useViewportClosing must be used inside a ViewportClosingProvider");
  }
  return value;
}
