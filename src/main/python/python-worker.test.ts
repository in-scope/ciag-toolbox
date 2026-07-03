// Integration tests for the subprocess worker harness against the real bundled
// interpreter. The runtime is installed by `node scripts/setup-python-runtime.mjs`;
// on a machine without it, the suite is skipped rather than failing the unit run.
import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { encodeCubeAsFloat32Payload, type CubeForUserScript } from "./cube-payload";
import { resolveActivePythonInterpreterPath } from "./interpreter-resolver";
import { runUserScriptInPythonSubprocess } from "./python-worker";
import { prepareImportedUserScriptFromFilePath } from "./script-import";
import { writeZipArchiveWithEntries } from "./zip-archive-test-helper";

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
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "script", scriptSource },
      cube: null,
      sandbox: false,
      timeoutMs,
    });
  }

  function runSandboxedScript(scriptSource: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "script", scriptSource },
      cube: null,
      sandbox: true,
      timeoutMs,
    });
  }

  function runSandboxedFormulaAgainstCube(expression: string, cube: CubeForUserScript) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "formula", expression },
      cube: encodeCubeAsFloat32Payload(cube),
      sandbox: true,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  function runFormulaAgainstCube(expression: string, cube: CubeForUserScript) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "formula", expression },
      cube: encodeCubeAsFloat32Payload(cube),
      sandbox: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  function runScriptAgainstCube(scriptSource: string, cube: CubeForUserScript) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "script", scriptSource },
      cube: encodeCubeAsFloat32Payload(cube),
      sandbox: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  async function runImportedZipToolAgainstCube(entries: Record<string, string>, cube: CubeForUserScript) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    const workingDirectory = await fs.mkdtemp(path.join(tmpdir(), "msi-imported-tool-test-"));
    const zipPath = path.join(workingDirectory, "tool.zip");
    await writeZipArchiveWithEntries(zipPath, entries);
    const prepared = await prepareImportedUserScriptFromFilePath(zipPath);
    try {
      return await runUserScriptInPythonSubprocess({
        interpreterPath,
        input: prepared.input,
        cube: encodeCubeAsFloat32Payload(cube),
        sandbox: false,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    } finally {
      await prepared.releaseResources();
      await fs.rm(workingDirectory, { recursive: true, force: true });
    }
  }

  const sampleCube: CubeForUserScript = {
    bands: [Float32Array.from([1, 2, 3, 4]), Float32Array.from([10, 20, 30, 40])],
    height: 2,
    width: 2,
    wavelengths: [500, 600],
  };

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

  it("runs an inline formula returning a weight vector, matching a pure-TS reference", async () => {
    const outcome = await runFormulaAgainstCube("cube.mean(axis=(1, 2))", sampleCube);
    const expectedBandMeans = sampleCube.bands.map((band) => band.reduce((s, v) => s + v, 0) / band.length);
    expect(outcome).toEqual({ kind: "completed", value: expectedBandMeans });
  }, 60_000);

  it("runs an inline formula returning an H x W band, matching a pure-TS reference", async () => {
    const outcome = await runFormulaAgainstCube("cube[1] - cube[0]", sampleCube);
    expect(outcome).toEqual({
      kind: "completed",
      value: [
        [9, 18],
        [27, 36],
      ],
    });
  }, 60_000);

  it("rejects a multi-statement formula with a clear single-expression error", async () => {
    const outcome = await runFormulaAgainstCube("weights = cube.mean(axis=(1, 2))", sampleCube);
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: "script-error",
      userFacingMessage: expect.stringContaining("A formula must be a single Python expression"),
    });
  }, 60_000);

  it("passes wavelengths through to an imported-style run(cube, wavelengths=None)", async () => {
    const outcome = await runScriptAgainstCube(
      "def run(cube, wavelengths=None):\n    return list(wavelengths)\n",
      sampleCube,
    );
    expect(outcome).toEqual({ kind: "completed", value: [500, 600] });
  }, 60_000);

  it("surfaces a script that returns NaN as a script error, not invalid JSON", async () => {
    const outcome = await runFormulaAgainstCube("cube * float('nan')", sampleCube);
    expect(outcome).toMatchObject({ kind: "failed", reason: "script-error" });
  }, 60_000);

  it("runs an imported multi-module .zip tool, matching a pure-TS reference", async () => {
    const outcome = await runImportedZipToolAgainstCube(
      {
        "main.py": "from combine import combine_bands\n\n\ndef run(cube, wavelengths=None):\n    return combine_bands(cube)\n",
        "combine.py": "def combine_bands(cube):\n    return cube[0] * 2 - cube[1]\n",
      },
      sampleCube,
    );
    const expectedBand = combinePerPixelReference(sampleCube, (first, second) => first * 2 - second);
    expect(outcome).toEqual({ kind: "completed", value: expectedBand });
  }, 60_000);

  it("surfaces an imported .zip whose main.py has no run() as a script error", async () => {
    const outcome = await runImportedZipToolAgainstCube({ "main.py": "answer = 42\n" }, sampleCube);
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: "script-error",
      userFacingMessage: "The script failed: The tool's main.py must define a run() function.",
    });
  }, 60_000);

  it("still runs a legitimate numpy computation under the bundled sandbox", async () => {
    const outcome = await runSandboxedFormulaAgainstCube("cube.mean(axis=(1, 2))", sampleCube);
    const expectedBandMeans = sampleCube.bands.map((band) => band.reduce((s, v) => s + v, 0) / band.length);
    expect(outcome).toEqual({ kind: "completed", value: expectedBandMeans });
  }, 60_000);

  it("denies filesystem writes to a sandboxed script", async () => {
    const outcome = await runSandboxedScript(
      "def run():\n    open(r'C:/msi-sandbox-probe.txt', 'w').write('x')\n    return 'wrote'\n",
    );
    expect(outcome).toMatchObject({ kind: "failed", reason: "script-error" });
    expect((outcome as { userFacingMessage: string }).userFacingMessage).toContain("blocked in bundled mode");
  }, 60_000);

  it("denies reading an arbitrary file outside the runtime from a sandboxed script", async () => {
    const outcome = await runSandboxedScript(
      "def run():\n    open(r'C:/Windows/win.ini', 'r').read()\n    return 'read'\n",
    );
    expect(outcome).toMatchObject({ kind: "failed", reason: "script-error" });
    expect((outcome as { userFacingMessage: string }).userFacingMessage).toContain("filesystem");
  }, 60_000);

  it("denies opening a network connection from a sandboxed script", async () => {
    const outcome = await runSandboxedScript(
      "def run():\n    import socket\n    socket.socket().connect(('127.0.0.1', 9))\n    return 'connected'\n",
    );
    expect(outcome).toMatchObject({ kind: "failed", reason: "script-error" });
    expect((outcome as { userFacingMessage: string }).userFacingMessage).toContain("blocked in bundled mode");
  }, 60_000);

  it("still kills a runaway sandboxed script at the wall-clock limit", async () => {
    const outcome = await runSandboxedScript("def run():\n    while True:\n        pass\n", 1_500);
    expect(outcome).toEqual({
      kind: "failed",
      reason: "timeout",
      userFacingMessage: "The script exceeded the 1.5-second limit and was stopped.",
    });
  }, 60_000);
});

function combinePerPixelReference(
  cube: CubeForUserScript,
  combineTwoBands: (first: number, second: number) => number,
): number[][] {
  const rows: number[][] = [];
  for (let row = 0; row < cube.height; row += 1) {
    rows.push(buildCombinedRow(cube, row, combineTwoBands));
  }
  return rows;
}

function buildCombinedRow(
  cube: CubeForUserScript,
  row: number,
  combineTwoBands: (first: number, second: number) => number,
): number[] {
  const columns: number[] = [];
  for (let column = 0; column < cube.width; column += 1) {
    const pixelIndex = row * cube.width + column;
    columns.push(combineTwoBands(cube.bands[0]![pixelIndex]!, cube.bands[1]![pixelIndex]!));
  }
  return columns;
}
