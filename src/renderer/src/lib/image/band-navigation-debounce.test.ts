import { describe, expect, it } from "vitest";

import { stepBandIndexInDirection } from "./band-navigation";
import { createBandSelectionDebouncer, type DebounceTimerControls } from "./band-navigation-debounce";

function createManualTimerControls(): { controls: DebounceTimerControls; elapse: () => void } {
  let pendingCallback: (() => void) | null = null;
  let nextHandle = 1;
  const controls: DebounceTimerControls = {
    schedule: (onElapsed) => {
      pendingCallback = onElapsed;
      return nextHandle++;
    },
    cancel: () => {
      pendingCallback = null;
    },
  };
  return {
    controls,
    elapse: () => {
      const callbackToRun = pendingCallback;
      pendingCallback = null;
      callbackToRun?.();
    },
  };
}

describe("createBandSelectionDebouncer", () => {
  it("loads only the band the user settles on after a multi-band sweep", () => {
    const loadedBandIndexes: number[] = [];
    const { controls, elapse } = createManualTimerControls();
    const debouncer = createBandSelectionDebouncer((i) => loadedBandIndexes.push(i), 120, controls);
    for (let bandIndex = 1; bandIndex <= 7; bandIndex++) debouncer.requestBandSelection(bandIndex);
    elapse();
    expect(loadedBandIndexes).toEqual([7]);
  });

  it("loads a single-step band change of one when the step settles", () => {
    const loadedBandIndexes: number[] = [];
    const { controls, elapse } = createManualTimerControls();
    const debouncer = createBandSelectionDebouncer((i) => loadedBandIndexes.push(i), 120, controls);
    debouncer.requestBandSelection(stepBandIndexInDirection(3, 1, 10));
    elapse();
    expect(loadedBandIndexes).toEqual([4]);
  });

  it("does not load a pending band after the pending selection is cancelled", () => {
    const loadedBandIndexes: number[] = [];
    const { controls, elapse } = createManualTimerControls();
    const debouncer = createBandSelectionDebouncer((i) => loadedBandIndexes.push(i), 120, controls);
    debouncer.requestBandSelection(2);
    debouncer.cancelPendingBandSelection();
    elapse();
    expect(loadedBandIndexes).toEqual([]);
  });
});
