import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  arePanelSizesAllEqual,
  compactPanelLinkGroupsAfterRemovingIndex,
  getLinkedPanelIndices,
  isPanelLinked,
  linkPanelsIntoOneGroup,
  NO_PANEL_LINK_GROUPS,
  prunePanelLinkGroupsToCellCount,
  unlinkPanelFromItsGroup,
  type PanelLinkGroups,
  type PanelSize,
} from "@/lib/grid/panel-link-groups";
import type { UserView } from "@/lib/webgl/view-transform";

// CT-207: coordinates linked pan & zoom. The disjoint link groups live in React
// state so panel chrome can reflect them; the live transform fan-out is imperative
// (a source panel publishes its view, linked peers apply it) and never routed
// through React state, so a drag does not trigger a render per frame.

export interface PanelLinkTarget {
  readonly getUserView: () => UserView;
  readonly applyUserView: (view: UserView) => void;
  readonly getPanelSize: () => PanelSize | null;
}

export type PanelLinkFailureReason = "too-few-panels" | "different-size";

export type PanelLinkAttemptResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PanelLinkFailureReason };

export interface PanelLinkApi {
  readonly groups: PanelLinkGroups;
  readonly isPanelLinked: (panelIndex: number) => boolean;
  readonly linkPanels: (panelIndices: ReadonlyArray<number>) => PanelLinkAttemptResult;
  readonly unlinkPanel: (panelIndex: number) => void;
  readonly registerLinkTarget: (panelIndex: number, target: PanelLinkTarget) => () => void;
  readonly notifyPanelViewTransformChanged: (panelIndex: number) => void;
  readonly compactAfterRemovingIndex: (removedIndex: number) => void;
  readonly pruneToCellCount: (cellCount: number) => void;
}

const PanelLinkContext = createContext<PanelLinkApi | null>(null);

export function PanelLinkProvider({ children }: { children: ReactNode }): JSX.Element {
  const value = usePanelLinkInternalState();
  return <PanelLinkContext.Provider value={value}>{children}</PanelLinkContext.Provider>;
}

export function usePanelLink(): PanelLinkApi {
  const value = useContext(PanelLinkContext);
  if (!value) throw new Error("usePanelLink must be used inside a PanelLinkProvider");
  return value;
}

function usePanelLinkInternalState(): PanelLinkApi {
  const [groups, setGroups] = useState<PanelLinkGroups>(NO_PANEL_LINK_GROUPS);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const registryRef = useRef(new Map<number, PanelLinkTarget>());
  const isApplyingRef = useRef(false);
  const registerLinkTarget = useRegisterLinkTargetCallback(registryRef);
  const linkPanels = useLinkPanelsCallback(registryRef, groupsRef, setGroups);
  const notifyPanelViewTransformChanged = useBroadcastCallback(registryRef, groupsRef, isApplyingRef);
  return useMemo(
    () =>
      buildPanelLinkApi({
        groups,
        linkPanels,
        registerLinkTarget,
        notifyPanelViewTransformChanged,
        setGroups,
      }),
    [groups, linkPanels, registerLinkTarget, notifyPanelViewTransformChanged],
  );
}

type PanelLinkTargetRegistry = React.MutableRefObject<Map<number, PanelLinkTarget>>;
type PanelLinkGroupsRef = React.MutableRefObject<PanelLinkGroups>;
type PanelLinkGroupsSetter = React.Dispatch<React.SetStateAction<PanelLinkGroups>>;

interface PanelLinkApiInputs {
  groups: PanelLinkGroups;
  linkPanels: PanelLinkApi["linkPanels"];
  registerLinkTarget: PanelLinkApi["registerLinkTarget"];
  notifyPanelViewTransformChanged: PanelLinkApi["notifyPanelViewTransformChanged"];
  setGroups: PanelLinkGroupsSetter;
}

function buildPanelLinkApi(inputs: PanelLinkApiInputs): PanelLinkApi {
  return {
    groups: inputs.groups,
    isPanelLinked: (panelIndex) => isPanelLinked(inputs.groups, panelIndex),
    linkPanels: inputs.linkPanels,
    unlinkPanel: (panelIndex) =>
      inputs.setGroups((current) => unlinkPanelFromItsGroup(current, panelIndex)),
    registerLinkTarget: inputs.registerLinkTarget,
    notifyPanelViewTransformChanged: inputs.notifyPanelViewTransformChanged,
    compactAfterRemovingIndex: (removedIndex) =>
      inputs.setGroups((current) => compactPanelLinkGroupsAfterRemovingIndex(current, removedIndex)),
    pruneToCellCount: (cellCount) =>
      inputs.setGroups((current) => prunePanelLinkGroupsToCellCount(current, cellCount)),
  };
}

function useRegisterLinkTargetCallback(
  registryRef: PanelLinkTargetRegistry,
): PanelLinkApi["registerLinkTarget"] {
  return useCallback(
    (panelIndex, target) => {
      registryRef.current.set(panelIndex, target);
      return () => registryRef.current.delete(panelIndex);
    },
    [registryRef],
  );
}

function useLinkPanelsCallback(
  registryRef: PanelLinkTargetRegistry,
  groupsRef: PanelLinkGroupsRef,
  setGroups: PanelLinkGroupsSetter,
): PanelLinkApi["linkPanels"] {
  return useCallback(
    (panelIndices) => {
      const distinct = [...new Set(panelIndices)];
      const validation = validateLinkRequest(registryRef.current, distinct);
      if (!validation.ok) return validation;
      setGroups(linkPanelsIntoOneGroup(groupsRef.current, distinct));
      return { ok: true };
    },
    [registryRef, groupsRef, setGroups],
  );
}

function validateLinkRequest(
  registry: Map<number, PanelLinkTarget>,
  distinctIndices: ReadonlyArray<number>,
): PanelLinkAttemptResult {
  const sizes = collectRegisteredPanelSizes(registry, distinctIndices);
  if (sizes.length < 2) return { ok: false, reason: "too-few-panels" };
  if (!arePanelSizesAllEqual(sizes)) return { ok: false, reason: "different-size" };
  return { ok: true };
}

function collectRegisteredPanelSizes(
  registry: Map<number, PanelLinkTarget>,
  indices: ReadonlyArray<number>,
): ReadonlyArray<PanelSize> {
  const sizes: PanelSize[] = [];
  for (const index of indices) {
    const size = registry.get(index)?.getPanelSize();
    if (size) sizes.push(size);
  }
  return sizes;
}

function useBroadcastCallback(
  registryRef: PanelLinkTargetRegistry,
  groupsRef: PanelLinkGroupsRef,
  isApplyingRef: React.MutableRefObject<boolean>,
): PanelLinkApi["notifyPanelViewTransformChanged"] {
  return useCallback(
    (panelIndex) => {
      if (isApplyingRef.current) return;
      broadcastSourceViewToLinkedPanels(registryRef.current, groupsRef.current, panelIndex, isApplyingRef);
    },
    [registryRef, groupsRef, isApplyingRef],
  );
}

function broadcastSourceViewToLinkedPanels(
  registry: Map<number, PanelLinkTarget>,
  groups: PanelLinkGroups,
  sourcePanelIndex: number,
  isApplyingRef: React.MutableRefObject<boolean>,
): void {
  const linkedIndices = getLinkedPanelIndices(groups, sourcePanelIndex);
  const source = registry.get(sourcePanelIndex);
  if (linkedIndices.length === 0 || !source) return;
  applyViewToLinkedPanelsWithReentrancyGuard(registry, source.getUserView(), linkedIndices, isApplyingRef);
}

function applyViewToLinkedPanelsWithReentrancyGuard(
  registry: Map<number, PanelLinkTarget>,
  view: UserView,
  linkedIndices: ReadonlyArray<number>,
  isApplyingRef: React.MutableRefObject<boolean>,
): void {
  isApplyingRef.current = true;
  try {
    for (const index of linkedIndices) registry.get(index)?.applyUserView(view);
  } finally {
    isApplyingRef.current = false;
  }
}
