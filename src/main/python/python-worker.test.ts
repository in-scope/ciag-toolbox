// Integration tests for the subprocess worker harness against the real bundled
// interpreter. The runtime is installed by `node scripts/setup-python-runtime.mjs`;
// on a machine without it, the suite is skipped rather than failing the unit run.
import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createChunkedUserScriptRunSessionStore,
  type ChunkedUserScriptRunSessionStore,
} from "./chunked-user-script-run";
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
      resultKind: "value",
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
      resultKind: "value",
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
      resultKind: "value",
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
      resultKind: "value",
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
      resultKind: "value",
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
        resultKind: "value",
        sandbox: false,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    } finally {
      await prepared.releaseResources();
      await fs.rm(workingDirectory, { recursive: true, force: true });
    }
  }

  function nextCubeResultSpoolPath(): string {
    return path.join(tmpdir(), `msi-worker-test-cube-result-${Date.now()}-${Math.floor(Math.random() * 1e9)}.bin`);
  }

  async function readSpooledFloats(spoolPath: string): Promise<number[]> {
    const bytes = await fs.readFile(spoolPath);
    return Array.from(new Float32Array(new Uint8Array(bytes).buffer));
  }

  function runFormulaForCubeResult(expression: string, cube: CubeForUserScript) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "formula", expression },
      cube: encodeCubeAsFloat32Payload(cube),
      resultKind: "cube",
      cubeResultSpoolPath: nextCubeResultSpoolPath(),
      sandbox: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  function runSandboxedCubeTransformScript(scriptSource: string, cube: CubeForUserScript) {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    return runUserScriptInPythonSubprocess({
      interpreterPath,
      input: { kind: "script", scriptSource },
      cube: encodeCubeAsFloat32Payload(cube),
      resultKind: "cube",
      cubeResultSpoolPath: nextCubeResultSpoolPath(),
      sandbox: true,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
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

  it("rejects a fresh user import of a non-allowlisted module under the bundled sandbox", async () => {
    const outcome = await runSandboxedScript(
      "def run():\n    import urllib.request\n    return 'imported'\n",
    );
    expect(outcome).toMatchObject({ kind: "failed", reason: "script-error" });
    expect((outcome as { userFacingMessage: string }).userFacingMessage).toContain("blocked in bundled mode");
  }, 60_000);

  it("still allows a fresh user import of an allowlisted module under the bundled sandbox", async () => {
    const outcome = await runSandboxedScript(
      "def run():\n    import statistics\n    return statistics.mean([1, 2, 3])\n",
    );
    expect(outcome).toEqual({ kind: "completed", value: 2 });
  }, 60_000);

  it("returns a doubled cube from a cube-result formula, matching a pure-TS reference", async () => {
    const outcome = await runFormulaForCubeResult("cube * 2", sampleCube);
    if (outcome.kind !== "completed-cube") throw new Error(`unexpected outcome ${JSON.stringify(outcome)}`);
    expect(outcome.shape).toEqual([2, 2, 2]);
    expect(outcome.totalBytes).toBe(32);
    const expectedValues = sampleCube.bands.flatMap((band) => Array.from(band, (value) => value * 2));
    expect(await readSpooledFloats(outcome.spoolPath)).toEqual(expectedValues);
    await fs.rm(outcome.spoolPath, { force: true });
  }, 60_000);

  it("rejects a 2-dimensional return from a cube-result run as a script error", async () => {
    const outcome = await runFormulaForCubeResult("cube[0]", sampleCube);
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: "script-error",
      userFacingMessage: expect.stringContaining("(bands, height, width)"),
    });
  }, 60_000);

  it("rejects a NaN-containing return from a cube-result run as a script error", async () => {
    const outcome = await runFormulaForCubeResult("cube * float('nan')", sampleCube);
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: "script-error",
      userFacingMessage: expect.stringContaining("finite"),
    });
  }, 60_000);

  // CT-219g: proves the chunked transfer chain at a size spanning many chunks
  // (~100 MB cube, byte-misaligned upload pieces, multi-chunk result pull),
  // composing the session store with a real worker run exactly like the IPC layer.
  it("round-trips a multi-chunk large cube through the chunked session store and the worker", async () => {
    if (interpreterPath === null) throw new Error("unreachable: suite is skipped");
    const bandCount = 6;
    const height = 2048;
    const width = 2048;
    const store = createChunkedUserScriptRunSessionStore(8 * 1024 * 1024);
    const token = await store.begin({
      cube: { bandCount, height, width, wavelengths: null },
      resultKind: "cube",
      input: { kind: "formula", expression: "cube * 2" },
      releaseInputResources: () => Promise.resolve(),
      sourceName: null,
      interpreterPath,
      sandbox: true,
    });
    await uploadSyntheticBandsInMisalignedChunks(store, token, bandCount, height * width);
    const run = store.takeExecutableRun(token);
    const outcome = await runUserScriptInPythonSubprocess({
      interpreterPath: run.interpreterPath,
      input: run.input,
      cube: run.cube,
      resultKind: run.resultKind,
      cubeResultSpoolPath: run.cubeResultSpoolPath,
      sandbox: run.sandbox,
      timeoutMs: 120_000,
    });
    if (outcome.kind !== "completed-cube") {
      throw new Error(`unexpected outcome ${JSON.stringify(outcome)}`);
    }
    expect(outcome.shape).toEqual([bandCount, height, width]);
    store.storeCubeResultForPull(token, outcome.shape, outcome.totalBytes);
    const bands = await pullAllResultBandsFromStore(store, token, bandCount, height * width);
    expectDoubledSyntheticSpotValues(bands, height * width);
    await store.release(token);
  }, 240_000);

  it("still enforces the bundled sandbox for a cube-transform run", async () => {
    const outcome = await runSandboxedCubeTransformScript(
      "def run(cube, wavelengths=None):\n    open(r'C:/msi-sandbox-probe.txt', 'w').write('x')\n    return cube\n",
      sampleCube,
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

const SYNTHETIC_VALUE_MODULUS = 977;
const SYNTHETIC_UPLOAD_PIECE_BYTES = 7_000_003;

function syntheticBandValue(bandIndex: number, pixelIndex: number): number {
  return (bandIndex + 1) * 1000 + (pixelIndex % SYNTHETIC_VALUE_MODULUS);
}

function buildSyntheticBand(bandIndex: number, pixelCount: number): Float32Array {
  const band = new Float32Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    band[pixelIndex] = syntheticBandValue(bandIndex, pixelIndex);
  }
  return band;
}

// Piece size is deliberately NOT a multiple of 4, so chunk boundaries fall
// inside float32 samples and across band boundaries, like real IPC chunks may.
async function uploadSyntheticBandsInMisalignedChunks(
  store: ChunkedUserScriptRunSessionStore,
  token: string,
  bandCount: number,
  pixelCount: number,
): Promise<void> {
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    const bytes = new Uint8Array(buildSyntheticBand(bandIndex, pixelCount).buffer);
    for (let offset = 0; offset < bytes.byteLength; offset += SYNTHETIC_UPLOAD_PIECE_BYTES) {
      await store.appendCubeChunk(token, bytes.subarray(offset, offset + SYNTHETIC_UPLOAD_PIECE_BYTES));
    }
  }
}

async function pullAllResultBandsFromStore(
  store: ChunkedUserScriptRunSessionStore,
  token: string,
  bandCount: number,
  pixelCount: number,
): Promise<Float32Array[]> {
  const combined = new Uint8Array(bandCount * pixelCount * 4);
  let offset = 0;
  let done = false;
  while (!done) {
    const chunk = await store.readNextResultChunk(token);
    combined.set(chunk.bytes, offset);
    offset += chunk.bytes.byteLength;
    done = chunk.done;
  }
  expect(offset).toBe(combined.byteLength);
  return Array.from({ length: bandCount }, (_, bandIndex) =>
    new Float32Array(combined.buffer, bandIndex * pixelCount * 4, pixelCount),
  );
}

function expectDoubledSyntheticSpotValues(bands: Float32Array[], pixelCount: number): void {
  const spots = [0, 1, SYNTHETIC_VALUE_MODULUS - 1, SYNTHETIC_VALUE_MODULUS, Math.floor(pixelCount / 2), pixelCount - 1];
  bands.forEach((band, bandIndex) => {
    for (const pixelIndex of spots) {
      expect(band[pixelIndex]).toBe(2 * syntheticBandValue(bandIndex, pixelIndex));
    }
  });
}

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
