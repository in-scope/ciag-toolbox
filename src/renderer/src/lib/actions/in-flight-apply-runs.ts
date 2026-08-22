// CT-269: bookkeeping for applies that are still in flight. Each run records
// which panel it reads (sourceIndex) and which panel it has reserved for its
// result (targetIndex), so a concurrent apply can never pick the same target,
// closing a reserved target cancels the run instead of letting the result
// resurrect the panel, and closing a run's source panel can be refused with a
// toast naming the operation. Indexes are LIVE: when a panel closes and the
// grid compacts, every recorded index above the removed panel shifts down with
// it, so a run finishing after an unrelated close still lands in the right
// panel.

export interface InFlightApplyRun {
  readonly runId: number;
  readonly sourceIndex: number;
  readonly targetIndex: number;
  readonly operationLabel: string;
  readonly requestStop: (() => void) | null;
  readonly cancelled: boolean;
}

export type InFlightApplyRunList = ReadonlyArray<InFlightApplyRun>;

export function appendReservedApplyRun(
  runs: InFlightApplyRunList,
  run: InFlightApplyRun,
): InFlightApplyRunList {
  return [...runs, run];
}

export function removeApplyRunById(
  runs: InFlightApplyRunList,
  runId: number,
): InFlightApplyRunList {
  return runs.filter((run) => run.runId !== runId);
}

export function findApplyRunById(
  runs: InFlightApplyRunList,
  runId: number,
): InFlightApplyRun | null {
  return runs.find((run) => run.runId === runId) ?? null;
}

// A reserved target stays excluded from empty-panel searches until the run
// fully ends (release), even after a cancel, so nothing can land in a panel a
// dying run still references.
export function listReservedResultTargetIndexes(
  runs: InFlightApplyRunList,
): ReadonlySet<number> {
  return new Set(runs.map((run) => run.targetIndex));
}

export function findRunningOperationLabelReadingSourceIndex(
  runs: InFlightApplyRunList,
  sourceIndex: number,
): string | null {
  const run = runs.find(
    (candidate) => !candidate.cancelled && candidate.sourceIndex === sourceIndex,
  );
  return run ? run.operationLabel : null;
}

export function hasApplyRunReservingTargetIndex(
  runs: InFlightApplyRunList,
  targetIndex: number,
): boolean {
  return runs.some((run) => run.targetIndex === targetIndex);
}

export interface MarkCancelledResult {
  readonly runs: InFlightApplyRunList;
  readonly cancelledRuns: InFlightApplyRunList;
}

export function markApplyRunsTargetingIndexCancelled(
  runs: InFlightApplyRunList,
  targetIndex: number,
): MarkCancelledResult {
  const cancelledRuns = runs.filter(
    (run) => run.targetIndex === targetIndex && !run.cancelled,
  );
  if (cancelledRuns.length === 0) return { runs, cancelledRuns };
  const next = runs.map((run) =>
    run.targetIndex === targetIndex ? { ...run, cancelled: true } : run,
  );
  return { runs: next, cancelledRuns };
}

export function shiftApplyRunIndexesAfterViewportRemoved(
  runs: InFlightApplyRunList,
  removedIndex: number,
): InFlightApplyRunList {
  return runs.map((run) => ({
    ...run,
    sourceIndex: shiftIndexDownWhenAboveRemoved(run.sourceIndex, removedIndex),
    targetIndex: shiftIndexDownWhenAboveRemoved(run.targetIndex, removedIndex),
  }));
}

function shiftIndexDownWhenAboveRemoved(index: number, removedIndex: number): number {
  return index > removedIndex ? index - 1 : index;
}

export function formatCloseRefusedWhileOperationReadsPanel(
  viewportNumber: number,
  operationLabel: string,
): string {
  return `Cannot close panel ${viewportNumber} while ${operationLabel} is running on it`;
}
