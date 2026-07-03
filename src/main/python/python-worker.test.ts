// Integration tests for the subprocess worker harness against the real bundled
// interpreter. The runtime is installed by `node scripts/setup-python-runtime.mjs`;
// on a machine without it, the suite is skipped rather than failing the unit run.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { resolveActivePythonInterpreterPath } from "./interpreter-resolver";
import { runUserScriptInPythonSubprocess } from "./python-worker";

function tryResolveDevelopmentInterpreterPathOrNull(): string | null {
  try {
    return resolveActivePythonInterpreterPath({
      isPackagedApp: false,
      packagedResourcesPath: "",
      developmentRepoRootPath: process.cwd(),
      platform: process.platform,
      fileExists: existsSync,
    });
  } catch {
    return null;
  }
}

const interpreterPath = tryResolveDevelopmentInterpreterPathOrNull();

describe.skipIf(interpreterPath === null)("python worker integration (bundled runtime)", () => {
  const DEFAULT_TIMEOUT_MS = 30_000;

  function runScript(scriptSource: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({ interpreterPath, scriptSource, timeoutMs });
  }

  it("runs a trivial script via the bundled interpreter and returns its result", async () => {
    const outcome = await runScript("def run():\n    return 21 * 2\n");
    expect(outcome).toEqual({ kind: "completed", value: 42 });
  }, 60_000);

  it("imports the curated stack (numpy, scipy, scikit-image) inside the worker", async () => {
    const outcome = await runScript(
      [
        "def run():",
        "    import numpy",
        "    import scipy",
        "    import skimage",
        "    return [numpy.__version__, scipy.__version__, skimage.__version__]",
        "",
      ].join("\n"),
    );
    expect(outcome).toEqual({ kind: "completed", value: ["2.5.0", "1.18.0", "0.26.0"] });
  }, 120_000);

  it("kills a runaway script at the wall-clock limit and surfaces a user-facing error", async () => {
    const outcome = await runScript("def run():\n    while True:\n        pass\n", 1_500);
    expect(outcome).toEqual({
      kind: "failed",
      reason: "timeout",
      userFacingMessage: "The script exceeded the 1.5-second limit and was stopped.",
    });
  }, 60_000);

  it("surfaces a raising script as a script error, not a crash", async () => {
    const outcome = await runScript("def run():\n    raise ValueError('bad wavelength')\n");
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: "script-error",
      userFacingMessage: "The script failed: bad wavelength",
    });
  }, 60_000);

  it("surfaces a script without a run() function as a script error", async () => {
    const outcome = await runScript("answer = 42\n");
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: "script-error",
      userFacingMessage: "The script failed: The script must define a run() function.",
    });
  }, 60_000);

  it("does not let user print() output corrupt the response framing", async () => {
    const outcome = await runScript("def run():\n    print('progress noise')\n    return 'ok'\n");
    expect(outcome).toEqual({ kind: "completed", value: "ok" });
  }, 60_000);
});
