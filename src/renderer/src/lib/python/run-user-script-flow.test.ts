import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import type {
  BusyEntryHandle,
  BusyEntryRegistrar,
  BusyEntryUpdate,
} from "@/state/busy-state-context";

import type { UserScriptRunChunkedApi } from "./run-user-script-chunked";
import {
  describeUserScriptRunBusyLabel,
  runUserScriptOnRasterShowingViewportBusy,
} from "./run-user-script-flow";

interface BusyLogEntry {
  kind: "register" | "update" | "clear";
  detail?: unknown;
}

function buildRecordingBusyRegistrar(log: BusyLogEntry[]): BusyEntryRegistrar {
  const handle: BusyEntryHandle = {
    id: "busy-1",
    update: (next: BusyEntryUpdate) => log.push({ kind: "update", detail: next.progress }),
    clear: () => log.push({ kind: "clear" }),
  };
  return {
    registerAppBusyEntry: () => handle,
    registerViewportBusyEntry: (input) => {
      log.push({ kind: "register", detail: input.label });
      return handle;
    },
  };
}

function buildTinyRaster(): RasterImage {
  return {
    bandPixels: [Uint16Array.from([5, 6])],
    width: 2,
    height: 1,
    bandCount: 1,
    sampleFormat: "uint",
    bitsPerSample: 16,
  };
}

function buildFakeApi(begin: ToolboxUserScriptRunBeginResult): UserScriptRunChunkedApi {
  return {
    beginUserScriptRun: () => Promise.resolve(begin),
    sendUserScriptRunCubeChunk: () => Promise.resolve(),
    executeUserScriptRun: () => Promise.resolve({ status: "completed", value: [1] }),
    readUserScriptRunResultChunk: () => Promise.reject(new Error("unused")),
    releaseUserScriptRun: () => Promise.resolve(),
    cancelUserScriptRun: () => Promise.resolve(),
  };
}

describe("runUserScriptOnRasterShowingViewportBusy", () => {
  it("registers busy once the run is ready, forwards progress, and clears at the end", async () => {
    const log: BusyLogEntry[] = [];
    const result = await runUserScriptOnRasterShowingViewportBusy(
      { busyRegistrar: buildRecordingBusyRegistrar(log), viewportIndex: 3 },
      buildTinyRaster(),
      { mode: "formula", expression: "cube.mean()" },
      "value",
      buildFakeApi({ status: "ready", token: "tok", sourceName: null }),
    );
    expect(result).toEqual({ status: "completed", value: [1] });
    expect(log[0]).toEqual({ kind: "register", detail: "Running formula..." });
    expect(log.at(-1)).toEqual({ kind: "clear" });
    const progressUpdates = log.filter((entry) => entry.kind === "update").map((entry) => entry.detail);
    expect(progressUpdates[0]).toBe(0);
    expect(progressUpdates.at(-1)).toBeNull();
  });

  it("registers no busy entry when the run is canceled at the import dialog", async () => {
    const log: BusyLogEntry[] = [];
    const result = await runUserScriptOnRasterShowingViewportBusy(
      { busyRegistrar: buildRecordingBusyRegistrar(log), viewportIndex: 0 },
      buildTinyRaster(),
      { mode: "import" },
      "value",
      buildFakeApi({ status: "canceled" }),
    );
    expect(result).toEqual({ status: "canceled" });
    expect(log).toHaveLength(0);
  });
});

describe("describeUserScriptRunBusyLabel", () => {
  it("names the runs without implying the stack changes (that happens on Apply)", () => {
    expect(describeUserScriptRunBusyLabel({ mode: "formula", expression: "x" })).toBe(
      "Running formula...",
    );
    expect(describeUserScriptRunBusyLabel({ mode: "import" })).toBe("Running imported tool...");
  });
});

// CT-308: a built-in algorithm run adds per-run extras and a stop controller.
describe("runUserScriptOnRasterShowingViewportBusy with CT-308 bindings", () => {
  it("offers the stop controller as the busy card's Stop and forwards extras to the run", async () => {
    const recorded: RecordedBuiltinRun = { canceled: false };
    const api = buildRecordingBuiltinApi(recorded);
    const stopController = new AbortController();
    const result = await runUserScriptOnRasterShowingViewportBusy(
      {
        busyRegistrar: buildStopCapturingBusyRegistrar(recorded),
        viewportIndex: 1,
        stopController,
        extras: { masks: [Uint8Array.from([1, 0])], params: { bins: 8 } },
      },
      buildTinyRaster(),
      { mode: "builtin", scriptName: "npc" },
      "value",
      api,
    );
    expect(result).toEqual({ status: "completed", value: 0.5 });
    expect(recorded.begin?.masks).toEqual({ count: 1 });
    expect(recorded.executeParams).toEqual({ bins: 8 });
    expect(recorded.requestStop).toBeTypeOf("function");
  });

  it("kills the worker when the busy card's Stop is pressed mid-run", async () => {
    const recorded: RecordedBuiltinRun = { canceled: false };
    const stopController = new AbortController();
    const api = buildRecordingBuiltinApi(recorded, () => recorded.requestStop?.());
    await runUserScriptOnRasterShowingViewportBusy(
      { busyRegistrar: buildStopCapturingBusyRegistrar(recorded), viewportIndex: 1, stopController },
      buildTinyRaster(),
      { mode: "builtin", scriptName: "npc" },
      "value",
      api,
    ).catch(() => undefined);
    expect(recorded.canceled).toBe(true);
  });
});

interface RecordedBuiltinRun {
  requestStop?: (() => void) | undefined;
  canceled: boolean;
  begin?: ToolboxUserScriptRunBeginRequest;
  executeParams?: unknown;
}

function buildStopCapturingBusyRegistrar(recorded: RecordedBuiltinRun): BusyEntryRegistrar {
  const handle: BusyEntryHandle = { id: "busy-1", update: () => {}, clear: () => {} };
  return {
    registerAppBusyEntry: () => handle,
    registerViewportBusyEntry: (input) => {
      recorded.requestStop = input.requestStop;
      return handle;
    },
  };
}

function buildRecordingBuiltinApi(
  recorded: RecordedBuiltinRun,
  beforeExecute: () => void = () => undefined,
): UserScriptRunChunkedApi {
  return {
    beginUserScriptRun: (request) => {
      recorded.begin = request;
      return Promise.resolve({ status: "ready", token: "tok", sourceName: null });
    },
    sendUserScriptRunCubeChunk: () => Promise.resolve(),
    executeUserScriptRun: (request) => {
      recorded.executeParams = request.params;
      beforeExecute();
      return Promise.resolve({ status: "completed", value: 0.5 });
    },
    readUserScriptRunResultChunk: () => Promise.reject(new Error("unused")),
    releaseUserScriptRun: () => Promise.resolve(),
    cancelUserScriptRun: () => {
      recorded.canceled = true;
      return Promise.resolve();
    },
  };
}
