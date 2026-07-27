import { useCallback, useEffect, useState, type MutableRefObject } from "react";

import { isProjectDirty } from "./project-dirty-state";
import type { ProjectContentRevisionTracker } from "./use-project-content-revisions";

// CT-258: main intercepts the window close event and sends a close request;
// this hook answers it. A clean or empty session confirms immediately (no
// dialog); a dirty one opens the save-before-close dialog, whose three
// choices resolve here. "Save and close" reuses the existing Save Project
// flow and only confirms the close when the save actually completed, so a
// canceled save dialog or a failed save leaves the app open with panel state
// intact.

export interface WindowCloseGuardBindings {
  readonly imagesByIndexRef: MutableRefObject<ReadonlyMap<number, unknown>>;
  readonly revisionTracker: ProjectContentRevisionTracker;
  readonly saveProjectReportingSuccess: () => Promise<boolean>;
}

export interface WindowCloseGuardApi {
  readonly isSaveBeforeCloseDialogOpen: boolean;
  readonly saveProjectThenCloseWindow: () => void;
  readonly closeWindowWithoutSaving: () => void;
  readonly cancelCloseRequest: () => void;
}

export function useWindowCloseGuard(
  bindings: WindowCloseGuardBindings,
): WindowCloseGuardApi {
  const [isSaveBeforeCloseDialogOpen, setDialogOpen] = useState(false);
  useCloseRequestsFromMainProcess(bindings, setDialogOpen);
  return {
    isSaveBeforeCloseDialogOpen,
    saveProjectThenCloseWindow: useCallback(() => {
      setDialogOpen(false);
      void saveProjectThenConfirmCloseWhenSaved(bindings);
    }, [bindings]),
    closeWindowWithoutSaving: useCallback(() => {
      setDialogOpen(false);
      void window.toolboxApi.confirmWindowClose();
    }, []),
    cancelCloseRequest: useCallback(() => setDialogOpen(false), []),
  };
}

function useCloseRequestsFromMainProcess(
  bindings: WindowCloseGuardBindings,
  setDialogOpen: (open: boolean) => void,
): void {
  const handleCloseRequested = useCallback(() => {
    if (hasUnsavedWorkWorthAsking(bindings)) {
      setDialogOpen(true);
      return;
    }
    void window.toolboxApi.confirmWindowClose();
  }, [bindings, setDialogOpen]);
  useEffect(
    () => window.toolboxApi.onWindowCloseRequested(handleCloseRequested),
    [handleCloseRequested],
  );
}

function hasUnsavedWorkWorthAsking(bindings: WindowCloseGuardBindings): boolean {
  const hasAnyPanelContent = bindings.imagesByIndexRef.current.size > 0;
  return isProjectDirty(bindings.revisionTracker.readRevisions(), hasAnyPanelContent);
}

async function saveProjectThenConfirmCloseWhenSaved(
  bindings: WindowCloseGuardBindings,
): Promise<void> {
  const saved = await bindings.saveProjectReportingSuccess();
  if (!saved) return;
  void window.toolboxApi.confirmWindowClose();
}
