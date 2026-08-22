// CT-269: the mutable store the apply flow and the panel-close flow share.
// One store lives for the whole App session; every mutation notifies the
// optional onRunsChanged callback so React can re-render close affordances.
// All list arithmetic delegates to the pure helpers in in-flight-apply-runs.ts.
import {
  appendReservedApplyRun,
  findApplyRunById,
  findRunningOperationLabelReadingSourceIndex,
  hasApplyRunReservingTargetIndex,
  listReservedResultTargetIndexes,
  markApplyRunsTargetingIndexCancelled,
  removeApplyRunById,
  shiftApplyRunIndexesAfterViewportRemoved,
  type InFlightApplyRunList,
} from "@/lib/actions/in-flight-apply-runs";

export interface InFlightApplyRunInput {
  readonly sourceIndex: number;
  readonly targetIndex: number;
  readonly operationLabel: string;
  readonly requestStop: (() => void) | null;
}

// The live handle a running apply holds: cancellation state plus the run's
// CURRENT indexes (they shift when an unrelated panel closes mid-run).
export interface InFlightApplyRunReservation {
  readonly isCancelled: () => boolean;
  readonly currentSourceIndex: () => number;
  readonly currentTargetIndex: () => number;
  readonly release: () => void;
}

export interface InFlightApplyRunStore {
  readonly reserveApplyRun: (input: InFlightApplyRunInput) => InFlightApplyRunReservation;
  readonly listReservedResultTargetIndexes: () => ReadonlySet<number>;
  readonly findRunningOperationLabelReadingSourceIndex: (sourceIndex: number) => string | null;
  readonly hasApplyRunReservingTargetIndex: (targetIndex: number) => boolean;
  readonly cancelAndStopApplyRunsTargetingIndex: (targetIndex: number) => boolean;
  readonly shiftApplyRunIndexesAfterViewportRemoved: (removedIndex: number) => void;
}

interface MutableRunStoreState {
  runs: InFlightApplyRunList;
  nextRunId: number;
}

type ReplaceRuns = (next: InFlightApplyRunList) => void;

export function createInFlightApplyRunStore(onRunsChanged?: () => void): InFlightApplyRunStore {
  const state: MutableRunStoreState = { runs: [], nextRunId: 1 };
  const replaceRuns: ReplaceRuns = (next) => {
    state.runs = next;
    onRunsChanged?.();
  };
  return {
    reserveApplyRun: (input) => reserveApplyRunInState(state, replaceRuns, input),
    listReservedResultTargetIndexes: () => listReservedResultTargetIndexes(state.runs),
    findRunningOperationLabelReadingSourceIndex: (sourceIndex) =>
      findRunningOperationLabelReadingSourceIndex(state.runs, sourceIndex),
    hasApplyRunReservingTargetIndex: (targetIndex) =>
      hasApplyRunReservingTargetIndex(state.runs, targetIndex),
    cancelAndStopApplyRunsTargetingIndex: (targetIndex) =>
      cancelAndStopApplyRunsTargetingIndex(state, replaceRuns, targetIndex),
    shiftApplyRunIndexesAfterViewportRemoved: (removedIndex) =>
      replaceRuns(shiftApplyRunIndexesAfterViewportRemoved(state.runs, removedIndex)),
  };
}

function reserveApplyRunInState(
  state: MutableRunStoreState,
  replaceRuns: ReplaceRuns,
  input: InFlightApplyRunInput,
): InFlightApplyRunReservation {
  const runId = state.nextRunId;
  state.nextRunId += 1;
  replaceRuns(appendReservedApplyRun(state.runs, { ...input, runId, cancelled: false }));
  return buildReservationHandleForRun(state, replaceRuns, runId, input);
}

function buildReservationHandleForRun(
  state: MutableRunStoreState,
  replaceRuns: ReplaceRuns,
  runId: number,
  input: InFlightApplyRunInput,
): InFlightApplyRunReservation {
  const findRun = () => findApplyRunById(state.runs, runId);
  return {
    isCancelled: () => findRun()?.cancelled ?? true,
    currentSourceIndex: () => findRun()?.sourceIndex ?? input.sourceIndex,
    currentTargetIndex: () => findRun()?.targetIndex ?? input.targetIndex,
    release: () => replaceRuns(removeApplyRunById(state.runs, runId)),
  };
}

function cancelAndStopApplyRunsTargetingIndex(
  state: MutableRunStoreState,
  replaceRuns: ReplaceRuns,
  targetIndex: number,
): boolean {
  const { runs, cancelledRuns } = markApplyRunsTargetingIndexCancelled(state.runs, targetIndex);
  if (cancelledRuns.length === 0) return false;
  replaceRuns(runs);
  for (const run of cancelledRuns) run.requestStop?.();
  return true;
}
