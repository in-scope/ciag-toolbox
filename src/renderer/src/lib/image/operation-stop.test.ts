import { describe, expect, it } from "vitest";

import {
  isOperationStoppedError,
  OPERATION_STOPPED_MESSAGE,
  OperationStoppedError,
  throwIfOperationStopped,
} from "./operation-stop";

describe("operation stop token (CT-268)", () => {
  it("throwIfOperationStopped passes for no signal and an unaborted signal", () => {
    expect(() => throwIfOperationStopped(undefined)).not.toThrow();
    expect(() => throwIfOperationStopped(new AbortController().signal)).not.toThrow();
  });

  it("throwIfOperationStopped throws OperationStoppedError once the signal aborts", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfOperationStopped(controller.signal)).toThrow(OperationStoppedError);
  });

  it("the error carries the locked toast message and is recognized by name", () => {
    const error = new OperationStoppedError();
    expect(error.message).toBe(OPERATION_STOPPED_MESSAGE);
    expect(isOperationStoppedError(error)).toBe(true);
    expect(isOperationStoppedError(new Error("boom"))).toBe(false);
    expect(isOperationStoppedError("Operation stopped")).toBe(false);
  });
});
