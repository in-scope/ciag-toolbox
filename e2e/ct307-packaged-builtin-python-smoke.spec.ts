import { expect, test } from "@playwright/test";

import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";

// CT-307 packaged-build smoke (the CT-262 pattern): proves an INSTALLED (or
// unpacked) build resolves its built-in algorithm scripts under
// process.resourcesPath/builtin-python and runs one of them with params and
// masks through the chunked run protocol. Opt-in because it needs a packed build:
//   pnpm build:win   (afterPack verifies the runtime AND the builtin scripts)
//   $env:MSI_PACKAGED_APP_EXE = "<install dir>\CHARM Toolbox.exe"; pnpm e2e ct307
// No dev server is needed; the packaged renderer is self-contained.
//
// Oracle: the built-in NPC script over a hand-built 1-band 2x2 cube whose top
// row {0, 0} is category 1 and bottom row {10, 10} is category 2, with 2 bins
// over the data min-max: the classes bin disjointly, so the multi-class NPC is
// exactly 1. The run goes through the PRODUCTION chunked protocol surface
// (window.toolboxApi) - begin resolves the builtin, mask bytes ride the chunk
// channel after the cube bytes, and params carry the bin count - so a passing
// run is direct evidence the packaged resolver, extraResources packaging,
// sandbox read permission, and params/mask framing work together.

const packagedExecutablePath = process.env["MSI_PACKAGED_APP_EXE"];

test.skip(
  packagedExecutablePath === undefined,
  "Set MSI_PACKAGED_APP_EXE to an installed CHARM Toolbox executable to run the packaged smoke",
);

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp({ packagedExecutablePath });
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

interface BuiltinSmokeOutcome {
  status: string;
  message?: string;
  value?: unknown;
  progressFractions: number[];
}

// The e2e tsconfig only declares the close-guard slice of window.toolboxApi
// (launch-app.ts); this spec drives the chunked user-script run surface, so it
// types that slice locally (mirrors src/renderer/src/types/toolbox-api.d.ts).
interface ChunkedRunSmokeApi {
  beginUserScriptRun(request: {
    source: { mode: "builtin"; scriptName: string };
    resultKind: "value";
    cube: { bandCount: number; height: number; width: number; wavelengths: number[] | null };
    masks?: { count: number };
  }): Promise<
    | { status: "canceled" }
    | { status: "failed"; message: string }
    | { status: "ready"; token: string; sourceName: string | null }
  >;
  sendUserScriptRunCubeChunk(request: { token: string; bytes: Uint8Array }): Promise<void>;
  executeUserScriptRun(request: {
    token: string;
    params?: Record<string, unknown>;
  }): Promise<
    | { status: "completed"; value: unknown }
    | { status: "completed-cube"; shape: [number, number, number]; totalBytes: number }
    | { status: "failed"; message: string }
  >;
  releaseUserScriptRun(request: { token: string }): Promise<void>;
  onUserScriptRunProgress(
    listener: (event: { token: string; fraction: number }) => void,
  ): () => void;
}

test("the installed build runs the built-in NPC script with params and masks", async () => {
  const outcome = await launched.window.evaluate(async (): Promise<BuiltinSmokeOutcome> => {
    const api = window.toolboxApi as unknown as ChunkedRunSmokeApi;
    const progressFractions: number[] = [];
    const begun = await api.beginUserScriptRun({
      source: { mode: "builtin", scriptName: "npc" },
      resultKind: "value",
      cube: { bandCount: 1, height: 2, width: 2, wavelengths: null },
      masks: { count: 2 },
    });
    if (begun.status !== "ready") {
      return { status: begun.status, message: "message" in begun ? begun.message : undefined, progressFractions };
    }
    const unsubscribe = api.onUserScriptRunProgress((event) => {
      if (event.token === begun.token) progressFractions.push(event.fraction);
    });
    try {
      const cubeBytes = new Uint8Array(new Float32Array([0, 0, 10, 10]).buffer);
      await api.sendUserScriptRunCubeChunk({ token: begun.token, bytes: cubeBytes });
      await api.sendUserScriptRunCubeChunk({ token: begun.token, bytes: new Uint8Array([1, 1, 0, 0]) });
      await api.sendUserScriptRunCubeChunk({ token: begun.token, bytes: new Uint8Array([0, 0, 1, 1]) });
      const executed = await api.executeUserScriptRun({ token: begun.token, params: { bins: 2 } });
      if (executed.status !== "completed") {
        return {
          status: executed.status,
          message: "message" in executed ? executed.message : undefined,
          progressFractions,
        };
      }
      return { status: "completed", value: executed.value, progressFractions };
    } finally {
      unsubscribe();
      await api.releaseUserScriptRun({ token: begun.token }).catch(() => undefined);
    }
  });

  expect(outcome.message).toBeUndefined();
  expect(outcome.status).toBe("completed");
  expect(outcome.value as number).toBeCloseTo(1, 6);
  expect(outcome.progressFractions.length).toBeGreaterThan(0);
  expect(outcome.progressFractions.at(-1)).toBe(1);
});
