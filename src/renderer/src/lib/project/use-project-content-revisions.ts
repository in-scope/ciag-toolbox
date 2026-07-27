import { useEffect, useMemo, useRef, type MutableRefObject } from "react";

import {
  didAnyPanelContentEntryChange,
  INITIAL_PROJECT_REVISIONS,
  type ProjectRevisionPair,
} from "./project-dirty-state";

// CT-258: every panel-content change in the app flows through the one
// imagesByIndex map (display-only rendering state lives elsewhere), so the
// content revision advances by watching that map across commits. The tracker
// hands out imperative readers because the revisions are only consulted at
// save time and close time; nothing re-renders on a revision change.

export interface ProjectContentRevisionTracker {
  readonly readRevisions: () => ProjectRevisionPair;
  readonly readContentRevision: () => number;
  readonly markContentRevisionAsSaved: (revision: number) => void;
  readonly markNextContentChangeAsSaved: () => void;
}

export function useProjectContentRevisionTracker(
  imagesByIndex: ReadonlyMap<number, unknown>,
): ProjectContentRevisionTracker {
  const revisionsRef = useRef<ProjectRevisionPair>(INITIAL_PROJECT_REVISIONS);
  const previousImagesRef = useRef(imagesByIndex);
  const markSavedOnNextContentChangeRef = useRef(false);
  useEffect(() => {
    advanceRevisionsWhenPanelContentChanged(
      imagesByIndex,
      revisionsRef,
      previousImagesRef,
      markSavedOnNextContentChangeRef,
    );
  }, [imagesByIndex]);
  return useMemo(
    () => buildRevisionTrackerApi(revisionsRef, markSavedOnNextContentChangeRef),
    [],
  );
}

function advanceRevisionsWhenPanelContentChanged(
  nextImages: ReadonlyMap<number, unknown>,
  revisionsRef: MutableRefObject<ProjectRevisionPair>,
  previousImagesRef: MutableRefObject<ReadonlyMap<number, unknown>>,
  markSavedOnNextContentChangeRef: MutableRefObject<boolean>,
): void {
  if (!didAnyPanelContentEntryChange(previousImagesRef.current, nextImages)) return;
  previousImagesRef.current = nextImages;
  const contentRevision = revisionsRef.current.contentRevision + 1;
  const savedRevision = markSavedOnNextContentChangeRef.current
    ? contentRevision
    : revisionsRef.current.savedRevision;
  markSavedOnNextContentChangeRef.current = false;
  revisionsRef.current = { contentRevision, savedRevision };
}

function buildRevisionTrackerApi(
  revisionsRef: MutableRefObject<ProjectRevisionPair>,
  markSavedOnNextContentChangeRef: MutableRefObject<boolean>,
): ProjectContentRevisionTracker {
  return {
    readRevisions: () => revisionsRef.current,
    readContentRevision: () => revisionsRef.current.contentRevision,
    markContentRevisionAsSaved: (revision) => {
      revisionsRef.current = { ...revisionsRef.current, savedRevision: revision };
    },
    markNextContentChangeAsSaved: () => {
      markSavedOnNextContentChangeRef.current = true;
    },
  };
}
