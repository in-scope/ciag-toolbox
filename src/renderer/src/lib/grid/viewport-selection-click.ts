// Pure selection arithmetic for panel clicks (CT-265). The context provider in
// state/selection-context.tsx owns the React state and anchor ref; every
// decision about what a click does to the selection lives here so the Cmd-click
// (metaKey) and context-menu-click behaviors are locked by unit tests.

export interface ViewportSelectionClickModifiers {
  ctrlOrMeta: boolean;
  shift: boolean;
}

export interface ClickModifierKeyStates {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface ViewportSelectionAfterClick {
  selection: ReadonlySet<number>;
  anchor: number | null;
}

export function extractClickModifiers(
  keys: ClickModifierKeyStates,
): ViewportSelectionClickModifiers {
  return {
    ctrlOrMeta: keys.ctrlKey || keys.metaKey,
    shift: keys.shiftKey,
  };
}

export function computeSelectionAfterClick(
  previous: ReadonlySet<number>,
  anchor: number | null,
  index: number,
  modifiers: ViewportSelectionClickModifiers,
): ViewportSelectionAfterClick {
  if (modifiers.shift && anchor !== null) {
    return { selection: makeRowMajorRangeSet(anchor, index), anchor };
  }
  if (modifiers.ctrlOrMeta) {
    return { selection: toggleIndexInSelection(previous, index), anchor: index };
  }
  return { selection: new Set([index]), anchor: index };
}

// A context-menu click (right-click, or Ctrl-click on macOS) on a panel outside
// the current selection selects that panel alone, so the menu always applies to
// the panel under the cursor; on an already-selected panel it leaves the
// multi-selection intact.
export function computeSelectionAfterContextMenuClick(
  previous: ReadonlySet<number>,
  anchor: number | null,
  index: number,
): ViewportSelectionAfterClick {
  if (previous.has(index)) return { selection: previous, anchor };
  return { selection: new Set([index]), anchor: index };
}

export function collectPanelIndicesToLinkFromSelection(
  selectedIndices: ReadonlySet<number>,
  sourceIndex: number,
): ReadonlyArray<number> {
  const indices = new Set(selectedIndices);
  indices.add(sourceIndex);
  return [...indices];
}

function makeRowMajorRangeSet(anchor: number, current: number): ReadonlySet<number> {
  const start = Math.min(anchor, current);
  const end = Math.max(anchor, current);
  const range = new Set<number>();
  for (let index = start; index <= end; index++) range.add(index);
  return range;
}

function toggleIndexInSelection(previous: ReadonlySet<number>, index: number): ReadonlySet<number> {
  const next = new Set(previous);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  return next;
}
