// CT-207: pure link-group model for linked pan & zoom. A "link group" is a set of
// 2+ panel indices whose viewport transform (pan/zoom) moves in sync. Groups are
// disjoint, each sorted ascending, and singletons are never stored. All operations
// are pure and return a normalized value; the imperative fan-out of the shared
// transform lives in the panel-link context, not here.

export type PanelLinkGroup = ReadonlyArray<number>;
export type PanelLinkGroups = ReadonlyArray<PanelLinkGroup>;

export const NO_PANEL_LINK_GROUPS: PanelLinkGroups = [];

export interface PanelSize {
  readonly width: number;
  readonly height: number;
}

export function findLinkGroupContainingPanel(
  groups: PanelLinkGroups,
  panelIndex: number,
): PanelLinkGroup | null {
  return groups.find((group) => group.includes(panelIndex)) ?? null;
}

export function isPanelLinked(groups: PanelLinkGroups, panelIndex: number): boolean {
  return findLinkGroupContainingPanel(groups, panelIndex) !== null;
}

export function getLinkedPanelIndices(
  groups: PanelLinkGroups,
  panelIndex: number,
): ReadonlyArray<number> {
  const group = findLinkGroupContainingPanel(groups, panelIndex);
  return group ? group.filter((index) => index !== panelIndex) : [];
}

export function arePanelSizesAllEqual(sizes: ReadonlyArray<PanelSize>): boolean {
  const first = sizes[0];
  if (!first) return false;
  return sizes.every((size) => size.width === first.width && size.height === first.height);
}

export function linkPanelsIntoOneGroup(
  groups: PanelLinkGroups,
  panelIndices: ReadonlyArray<number>,
): PanelLinkGroups {
  const merged = new Set(panelIndices);
  const untouchedGroups = absorbGroupsThatOverlapMergedSet(groups, merged);
  return normalizePanelLinkGroups([...untouchedGroups, [...merged]]);
}

function absorbGroupsThatOverlapMergedSet(
  groups: PanelLinkGroups,
  merged: Set<number>,
): PanelLinkGroups {
  const untouched: PanelLinkGroup[] = [];
  for (const group of groups) {
    if (group.some((index) => merged.has(index))) addAllIndicesToSet(group, merged);
    else untouched.push(group);
  }
  return untouched;
}

function addAllIndicesToSet(indices: ReadonlyArray<number>, target: Set<number>): void {
  for (const index of indices) target.add(index);
}

export function unlinkPanelFromItsGroup(
  groups: PanelLinkGroups,
  panelIndex: number,
): PanelLinkGroups {
  return normalizePanelLinkGroups(
    groups.map((group) => group.filter((index) => index !== panelIndex)),
  );
}

export function compactPanelLinkGroupsAfterRemovingIndex(
  groups: PanelLinkGroups,
  removedIndex: number,
): PanelLinkGroups {
  const shifted = groups.map((group) => shiftGroupIndicesAfterRemoval(group, removedIndex));
  return normalizePanelLinkGroups(shifted);
}

function shiftGroupIndicesAfterRemoval(
  group: PanelLinkGroup,
  removedIndex: number,
): ReadonlyArray<number> {
  return group
    .filter((index) => index !== removedIndex)
    .map((index) => (index > removedIndex ? index - 1 : index));
}

export function prunePanelLinkGroupsToCellCount(
  groups: PanelLinkGroups,
  cellCount: number,
): PanelLinkGroups {
  return normalizePanelLinkGroups(
    groups.map((group) => group.filter((index) => index < cellCount)),
  );
}

function normalizePanelLinkGroups(groups: PanelLinkGroups): PanelLinkGroups {
  return groups
    .map(sortUniqueAscending)
    .filter((group) => group.length >= 2)
    .sort((left, right) => left[0]! - right[0]!);
}

function sortUniqueAscending(indices: ReadonlyArray<number>): ReadonlyArray<number> {
  return [...new Set(indices)].sort((left, right) => left - right);
}
