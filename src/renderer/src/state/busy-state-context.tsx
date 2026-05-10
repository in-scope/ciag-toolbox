import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  addBusyEntryToMap,
  pickMostRecentAppBusyEntry,
  pickMostRecentViewportBusyEntry,
  removeBusyEntryFromMap,
  updateBusyEntryInMap,
  type BusyEntry,
  type BusyEntryMap,
  type BusyEntryUpdate,
  type BusyScope,
} from "./busy-entry-map";

export type { BusyEntry, BusyEntryUpdate, BusyScope } from "./busy-entry-map";

export interface BusyEntryHandle {
  readonly id: string;
  readonly update: (next: BusyEntryUpdate) => void;
  readonly clear: () => void;
}

export interface RegisterAppBusyEntryInput {
  readonly label: string;
  readonly progress?: number | null;
}

export interface RegisterViewportBusyEntryInput extends RegisterAppBusyEntryInput {
  readonly viewportIndex: number;
}

export interface BusyEntryRegistrar {
  readonly registerAppBusyEntry: (input: RegisterAppBusyEntryInput) => BusyEntryHandle;
  readonly registerViewportBusyEntry: (input: RegisterViewportBusyEntryInput) => BusyEntryHandle;
}

const BusyEntriesContext = createContext<BusyEntryMap | null>(null);
const BusyRegistrarContext = createContext<BusyEntryRegistrar | null>(null);

interface BusyStateProviderProps {
  children: ReactNode;
}

export function BusyStateProvider({ children }: BusyStateProviderProps): JSX.Element {
  const [entries, setEntries] = useState<BusyEntryMap>(createEmptyBusyEntryMap);
  const nextIdRef = useRef(0);
  const registrar = useStableBusyEntryRegistrar(setEntries, nextIdRef);
  return (
    <BusyRegistrarContext.Provider value={registrar}>
      <BusyEntriesContext.Provider value={entries}>{children}</BusyEntriesContext.Provider>
    </BusyRegistrarContext.Provider>
  );
}

function createEmptyBusyEntryMap(): BusyEntryMap {
  return new Map();
}

function useStableBusyEntryRegistrar(
  setEntries: React.Dispatch<React.SetStateAction<BusyEntryMap>>,
  nextIdRef: React.MutableRefObject<number>,
): BusyEntryRegistrar {
  const registerAppBusyEntry = useCallback(
    (input: RegisterAppBusyEntryInput): BusyEntryHandle =>
      registerBusyEntryWithScope(setEntries, nextIdRef, {
        scope: "app",
        viewportIndex: null,
        label: input.label,
        progress: input.progress ?? null,
      }),
    [setEntries, nextIdRef],
  );
  const registerViewportBusyEntry = useCallback(
    (input: RegisterViewportBusyEntryInput): BusyEntryHandle =>
      registerBusyEntryWithScope(setEntries, nextIdRef, {
        scope: "viewport",
        viewportIndex: input.viewportIndex,
        label: input.label,
        progress: input.progress ?? null,
      }),
    [setEntries, nextIdRef],
  );
  return useMemo(
    () => ({ registerAppBusyEntry, registerViewportBusyEntry }),
    [registerAppBusyEntry, registerViewportBusyEntry],
  );
}

interface RegisterBusyEntryArgs {
  readonly scope: BusyScope;
  readonly viewportIndex: number | null;
  readonly label: string;
  readonly progress: number | null;
}

function registerBusyEntryWithScope(
  setEntries: React.Dispatch<React.SetStateAction<BusyEntryMap>>,
  nextIdRef: React.MutableRefObject<number>,
  args: RegisterBusyEntryArgs,
): BusyEntryHandle {
  const id = generateNextBusyEntryId(nextIdRef);
  const entry: BusyEntry = {
    id,
    scope: args.scope,
    viewportIndex: args.viewportIndex,
    label: args.label,
    progress: args.progress,
    registeredAtMs: performance.now(),
  };
  setEntries((previous) => addBusyEntryToMap(previous, entry));
  return {
    id,
    update: (next) => setEntries((previous) => updateBusyEntryInMap(previous, id, next)),
    clear: () => setEntries((previous) => removeBusyEntryFromMap(previous, id)),
  };
}

function generateNextBusyEntryId(nextIdRef: React.MutableRefObject<number>): string {
  nextIdRef.current += 1;
  return `busy-${nextIdRef.current}`;
}

export function useBusyEntryRegistrar(): BusyEntryRegistrar {
  const registrar = useContext(BusyRegistrarContext);
  if (!registrar) {
    throw new Error("useBusyEntryRegistrar must be used inside a BusyStateProvider");
  }
  return registrar;
}

function useAllBusyEntries(): BusyEntryMap {
  const entries = useContext(BusyEntriesContext);
  if (!entries) {
    throw new Error("Busy entries can only be read inside a BusyStateProvider");
  }
  return entries;
}

export function useMostRecentAppBusyEntry(): BusyEntry | null {
  const entries = useAllBusyEntries();
  return useMemo(() => pickMostRecentAppBusyEntry(entries), [entries]);
}

export function useMostRecentViewportBusyEntry(viewportIndex: number): BusyEntry | null {
  const entries = useAllBusyEntries();
  return useMemo(
    () => pickMostRecentViewportBusyEntry(entries, viewportIndex),
    [entries, viewportIndex],
  );
}

const BUSY_INDICATOR_PAINT_DELAY_MS = 150;

export function useShouldRenderBusyEntryAfterDelay(entry: BusyEntry | null): boolean {
  const [hasPassedThreshold, setHasPassedThreshold] = useState(false);
  useEffect(() => {
    if (!entry) {
      setHasPassedThreshold(false);
      return undefined;
    }
    const elapsedSinceRegisteredMs = performance.now() - entry.registeredAtMs;
    const remainingDelayMs = Math.max(0, BUSY_INDICATOR_PAINT_DELAY_MS - elapsedSinceRegisteredMs);
    if (remainingDelayMs === 0) {
      setHasPassedThreshold(true);
      return undefined;
    }
    const timeoutId = window.setTimeout(() => setHasPassedThreshold(true), remainingDelayMs);
    return () => window.clearTimeout(timeoutId);
  }, [entry]);
  if (!entry) return false;
  return hasPassedThreshold;
}
