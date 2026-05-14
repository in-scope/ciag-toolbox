import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface RegionToolApi {
  readonly isRegionToolActive: boolean;
  readonly setRegionToolActive: (active: boolean) => void;
  readonly toggleRegionTool: () => void;
}

const RegionToolContext = createContext<RegionToolApi | null>(null);

interface RegionToolProviderProps {
  readonly children: ReactNode;
}

export function RegionToolProvider({ children }: RegionToolProviderProps): JSX.Element {
  const value = useRegionToolInternalState();
  return <RegionToolContext.Provider value={value}>{children}</RegionToolContext.Provider>;
}

export function useRegionTool(): RegionToolApi {
  const value = useContext(RegionToolContext);
  if (!value) {
    throw new Error("useRegionTool must be used inside a RegionToolProvider");
  }
  return value;
}

function useRegionToolInternalState(): RegionToolApi {
  const [isRegionToolActive, setIsRegionToolActive] = useState(false);
  const setRegionToolActive = useCallback(
    (next: boolean) => setIsRegionToolActive(next),
    [],
  );
  const toggleRegionTool = useCallback(
    () => setIsRegionToolActive((prev) => !prev),
    [],
  );
  return useMemo(
    () => ({ isRegionToolActive, setRegionToolActive, toggleRegionTool }),
    [isRegionToolActive, setRegionToolActive, toggleRegionTool],
  );
}
