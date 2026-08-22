import { describe, expect, it, vi } from "vitest";

import { createInFlightApplyRunStore } from "./in-flight-apply-run-store";

describe("in-flight apply run store (CT-269)", () => {
  it("reserving a run excludes its target from the reserved set until release", () => {
    const store = createInFlightApplyRunStore();
    const reservation = store.reserveApplyRun({
      sourceIndex: 0,
      targetIndex: 1,
      operationLabel: "ICA",
      requestStop: null,
    });
    expect(store.listReservedResultTargetIndexes()).toEqual(new Set([1]));
    expect(store.hasApplyRunReservingTargetIndex(1)).toBe(true);
    reservation.release();
    expect(store.listReservedResultTargetIndexes()).toEqual(new Set());
  });

  it("two concurrent reservations hold distinct targets independently", () => {
    const store = createInFlightApplyRunStore();
    const first = store.reserveApplyRun({
      sourceIndex: 0,
      targetIndex: 1,
      operationLabel: "ICA",
      requestStop: null,
    });
    const second = store.reserveApplyRun({
      sourceIndex: 0,
      targetIndex: 2,
      operationLabel: "Invert",
      requestStop: null,
    });
    expect(store.listReservedResultTargetIndexes()).toEqual(new Set([1, 2]));
    first.release();
    expect(store.listReservedResultTargetIndexes()).toEqual(new Set([2]));
    expect(second.currentTargetIndex()).toBe(2);
  });

  it("cancelling a target marks the run cancelled and invokes its requestStop", () => {
    const store = createInFlightApplyRunStore();
    const requestStop = vi.fn();
    const reservation = store.reserveApplyRun({
      sourceIndex: 0,
      targetIndex: 1,
      operationLabel: "ICA",
      requestStop,
    });
    expect(store.cancelAndStopApplyRunsTargetingIndex(1)).toBe(true);
    expect(requestStop).toHaveBeenCalledTimes(1);
    expect(reservation.isCancelled()).toBe(true);
    expect(store.cancelAndStopApplyRunsTargetingIndex(1)).toBe(false);
  });

  it("cancelling an index with no run reports false and stops nothing", () => {
    const store = createInFlightApplyRunStore();
    expect(store.cancelAndStopApplyRunsTargetingIndex(4)).toBe(false);
  });

  it("finds the operation label reading a source panel while the run lives", () => {
    const store = createInFlightApplyRunStore();
    const reservation = store.reserveApplyRun({
      sourceIndex: 3,
      targetIndex: 4,
      operationLabel: "PCA",
      requestStop: null,
    });
    expect(store.findRunningOperationLabelReadingSourceIndex(3)).toBe("PCA");
    reservation.release();
    expect(store.findRunningOperationLabelReadingSourceIndex(3)).toBeNull();
  });

  it("shifting after a viewport removal updates the reservation's current indexes", () => {
    const store = createInFlightApplyRunStore();
    const reservation = store.reserveApplyRun({
      sourceIndex: 1,
      targetIndex: 3,
      operationLabel: "ICA",
      requestStop: null,
    });
    store.shiftApplyRunIndexesAfterViewportRemoved(0);
    expect(reservation.currentSourceIndex()).toBe(0);
    expect(reservation.currentTargetIndex()).toBe(2);
  });

  it("notifies onRunsChanged on reserve, cancel, shift, and release", () => {
    const onRunsChanged = vi.fn();
    const store = createInFlightApplyRunStore(onRunsChanged);
    const reservation = store.reserveApplyRun({
      sourceIndex: 0,
      targetIndex: 1,
      operationLabel: "ICA",
      requestStop: null,
    });
    store.cancelAndStopApplyRunsTargetingIndex(1);
    store.shiftApplyRunIndexesAfterViewportRemoved(0);
    reservation.release();
    expect(onRunsChanged).toHaveBeenCalledTimes(4);
  });
});
