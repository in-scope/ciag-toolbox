// CT-258: the close guard's dirty model. The renderer counts a content
// revision that advances on every change to panel CONTENT (opening or loading
// images, operation applies in place or to a new panel, band removal, panel
// close, panel duplication, re-import). Display-only rendering state (zoom,
// normalized viewing, the channel view, contrast-curve editing buffers) lives
// outside the content map and never advances the revision. A saved revision
// records the content revision on every successful project save and on
// project open completion.

export interface ProjectRevisionPair {
  readonly contentRevision: number;
  readonly savedRevision: number;
}

export const INITIAL_PROJECT_REVISIONS: ProjectRevisionPair = {
  contentRevision: 0,
  savedRevision: 0,
};

export function isProjectDirty(
  revisions: ProjectRevisionPair,
  hasAnyPanelContent: boolean,
): boolean {
  if (!hasAnyPanelContent) return false;
  return revisions.contentRevision !== revisions.savedRevision;
}

// The revision-increment classification: a change counts as a CONTENT change
// exactly when it added, removed, or replaced a panel's content entry.
// Display-only changes never touch the content map, so they never pass this
// predicate.
export function didAnyPanelContentEntryChange(
  previous: ReadonlyMap<number, unknown>,
  next: ReadonlyMap<number, unknown>,
): boolean {
  if (previous === next) return false;
  if (previous.size !== next.size) return true;
  return someEntryDiffersBetween(previous, next);
}

function someEntryDiffersBetween(
  previous: ReadonlyMap<number, unknown>,
  next: ReadonlyMap<number, unknown>,
): boolean {
  for (const [index, content] of next) {
    if (previous.get(index) !== content) return true;
  }
  return false;
}
