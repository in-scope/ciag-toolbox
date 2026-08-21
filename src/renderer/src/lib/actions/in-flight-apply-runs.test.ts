import { describe, expect, it } from "vitest";

import {
  appendReservedApplyRun,
  findApplyRunById,
  findRunningOperationLabelReadingSourceIndex,
  formatCloseRefusedWhileOperationReadsPanel,
  hasApplyRunReservingTargetIndex,
  listReservedResultTargetIndexes,
  markApplyRunsTargetingIndexCancelled,
  removeApplyRunById,
  shiftApplyRunIndexesAfterViewportRemoved,
  type InFlightApplyRun,
} from "./in-flight-apply-runs";

function buildRun(overrides: Partial<InFlightApplyRun> = {}): InFlightApplyRun {
  return {
    runId: 1,
    sourceIndex: 0,
    targetIndex: 1,
    operationLabel: "ICA",
    requestStop: null,
    cancelled: false,
    ...overrides,
  };
}

describe("in-flight apply run list (CT-269)", () => {
  it("appends and removes runs by id", () => {
    const runs = appendReservedApplyRun([], buildRun({ runId: 7 }));
    expect(findApplyRunById(runs, 7)?.runId).toBe(7);
    expect(removeApplyRunById(runs, 7)).toEqual([]);
    expect(findApplyRunById(runs, 99)).toBeNull();
  });

  it("lists every reserved target index, including cancelled runs", () => {
    const runs = [
      buildRun({ runId: 1, targetIndex: 1 }),
      buildRun({ runId: 2, targetIndex: 3, cancelled: true }),
    ];
    expect(listReservedResultTargetIndexes(runs)).toEqual(new Set([1, 3]));
  });

  it("finds the operation label reading a source index, ignoring cancelled runs", () => {
    const runs = [
      buildRun({ runId: 1, sourceIndex: 0, operationLabel: "ICA" }),
      buildRun({ runId: 2, sourceIndex: 2, operationLabel: "PCA", cancelled: true }),
    ];
    expect(findRunningOperationLabelReadingSourceIndex(runs, 0)).toBe("ICA");
    expect(findRunningOperationLabelReadingSourceIndex(runs, 2)).toBeNull();
    expect(findRunningOperationLabelReadingSourceIndex(runs, 5)).toBeNull();
  });

  it("reports whether any run reserves a target index", () => {
    const runs = [buildRun({ targetIndex: 2 })];
    expect(hasApplyRunReservingTargetIndex(runs, 2)).toBe(true);
    expect(hasApplyRunReservingTargetIndex(runs, 0)).toBe(false);
  });

  it("marks only the runs targeting the index as cancelled and returns them", () => {
    const runs = [
      buildRun({ runId: 1, targetIndex: 2 }),
      buildRun({ runId: 2, targetIndex: 3 }),
    ];
    const result = markApplyRunsTargetingIndexCancelled(runs, 2);
    expect(result.cancelledRuns.map((run) => run.runId)).toEqual([1]);
    expect(findApplyRunById(result.runs, 1)?.cancelled).toBe(true);
    expect(findApplyRunById(result.runs, 2)?.cancelled).toBe(false);
  });

  it("marking an index with no matching run returns the same list and no cancelled runs", () => {
    const runs = [buildRun({ runId: 1, targetIndex: 2 })];
    const result = markApplyRunsTargetingIndexCancelled(runs, 5);
    expect(result.runs).toBe(runs);
    expect(result.cancelledRuns).toEqual([]);
  });

  it("an already-cancelled run is not re-cancelled", () => {
    const runs = [buildRun({ runId: 1, targetIndex: 2, cancelled: true })];
    const result = markApplyRunsTargetingIndexCancelled(runs, 2);
    expect(result.cancelledRuns).toEqual([]);
  });

  it("shifts source and target indexes above a removed viewport down by one", () => {
    const runs = [buildRun({ sourceIndex: 1, targetIndex: 3 })];
    const shifted = shiftApplyRunIndexesAfterViewportRemoved(runs, 2);
    expect(shifted[0]?.sourceIndex).toBe(1);
    expect(shifted[0]?.targetIndex).toBe(2);
  });

  it("leaves indexes at or below the removed viewport unchanged", () => {
    const runs = [buildRun({ sourceIndex: 0, targetIndex: 2 })];
    const shifted = shiftApplyRunIndexesAfterViewportRemoved(runs, 2);
    expect(shifted[0]?.sourceIndex).toBe(0);
    expect(shifted[0]?.targetIndex).toBe(2);
  });

  it("formats the source-panel close refusal naming the operation", () => {
    expect(formatCloseRefusedWhileOperationReadsPanel(2, "ICA")).toBe(
      "Cannot close panel 2 while ICA is running on it",
    );
  });
});
