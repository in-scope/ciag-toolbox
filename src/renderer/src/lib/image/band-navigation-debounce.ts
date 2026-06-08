export interface DebounceTimerControls {
  schedule: (onElapsed: () => void, delayMs: number) => number;
  cancel: (timerHandle: number) => void;
}

export interface BandSelectionDebouncer {
  requestBandSelection: (bandIndex: number) => void;
  cancelPendingBandSelection: () => void;
}

interface PendingBandSelectionTimerState {
  timerHandle: number | null;
}

export const windowDebounceTimerControls: DebounceTimerControls = {
  schedule: (onElapsed, delayMs) => window.setTimeout(onElapsed, delayMs),
  cancel: (timerHandle) => window.clearTimeout(timerHandle),
};

export function createBandSelectionDebouncer(
  commitBandSelection: (bandIndex: number) => void,
  delayMs: number,
  timerControls: DebounceTimerControls,
): BandSelectionDebouncer {
  const state: PendingBandSelectionTimerState = { timerHandle: null };
  return {
    requestBandSelection: (bandIndex) =>
      scheduleBandSelectionAfterDelay(state, bandIndex, delayMs, timerControls, commitBandSelection),
    cancelPendingBandSelection: () => clearPendingBandSelectionTimer(state, timerControls),
  };
}

function scheduleBandSelectionAfterDelay(
  state: PendingBandSelectionTimerState,
  bandIndex: number,
  delayMs: number,
  timerControls: DebounceTimerControls,
  commitBandSelection: (bandIndex: number) => void,
): void {
  clearPendingBandSelectionTimer(state, timerControls);
  state.timerHandle = timerControls.schedule(() => {
    state.timerHandle = null;
    commitBandSelection(bandIndex);
  }, delayMs);
}

function clearPendingBandSelectionTimer(
  state: PendingBandSelectionTimerState,
  timerControls: DebounceTimerControls,
): void {
  if (state.timerHandle === null) return;
  timerControls.cancel(state.timerHandle);
  state.timerHandle = null;
}
