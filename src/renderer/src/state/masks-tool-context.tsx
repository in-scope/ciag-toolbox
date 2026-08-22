import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// CT-302: the Masks tool is a mode toggle, the same shape as the Select Region
// tool: one app-wide flag that decides whether the Masks options aside is open
// for the active panel. The mask DATA is per panel and lives in that panel's
// rendering state, not here.

export interface MasksToolApi {
  readonly isMasksToolActive: boolean;
  readonly setMasksToolActive: (active: boolean) => void;
  readonly toggleMasksTool: () => void;
}

const MasksToolContext = createContext<MasksToolApi | null>(null);

interface MasksToolProviderProps {
  readonly children: ReactNode;
}

export function MasksToolProvider({ children }: MasksToolProviderProps): JSX.Element {
  const value = useMasksToolInternalState();
  return <MasksToolContext.Provider value={value}>{children}</MasksToolContext.Provider>;
}

export function useMasksTool(): MasksToolApi {
  const value = useContext(MasksToolContext);
  if (!value) {
    throw new Error("useMasksTool must be used inside a MasksToolProvider");
  }
  return value;
}

function useMasksToolInternalState(): MasksToolApi {
  const [isMasksToolActive, setIsMasksToolActive] = useState(false);
  const setMasksToolActive = useCallback((next: boolean) => setIsMasksToolActive(next), []);
  const toggleMasksTool = useCallback(() => setIsMasksToolActive((prev) => !prev), []);
  return useMemo(
    () => ({ isMasksToolActive, setMasksToolActive, toggleMasksTool }),
    [isMasksToolActive, setMasksToolActive, toggleMasksTool],
  );
}
