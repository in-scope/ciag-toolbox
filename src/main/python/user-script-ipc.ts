import { BrowserWindow, ipcMain } from "electron";

import { showOpenDialogOrStub } from "../e2e-dialog-stub";
import { encodeCubeAsFloat32Payload, type CubeForUserScript } from "./cube-payload";
import { buildInterpreterResolutionEnvironment } from "./electron-interpreter-environment";
import { getConfiguredOwnInterpreterPath } from "./python-environment-controller";
import {
  resolvePythonInterpreterSelection,
  type PythonInterpreterSelection,
} from "./interpreter-resolver";
import {
  prepareImportedUserScriptFromFilePath,
  type PreparedImportedScript,
} from "./script-import";
import {
  runUserScriptInPythonSubprocess,
  type PythonWorkerOutcome,
} from "./python-worker";
import type { JsonValue } from "./worker-protocol";

// CT-209/CT-210: the renderer's band-ops popups run a user formula or imported
// tool against the current stack. The cube crosses IPC as Float32Array bands; the
// interpreter selection, sandbox decision, import dialog, subprocess run, and temp
// cleanup all live here so the renderer only sends the cube and gets weights/bands
// back. Bundled mode is sandboxed; own-environment mode (CT-208e) runs trusted.

const RUN_USER_SCRIPT_CHANNEL = "user-script:run";
const USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS = 30_000;

const IMPORTED_SCRIPT_FILE_FILTER: Electron.FileFilter = {
  name: "Python tool",
  extensions: ["py", "zip"],
};

export interface RunUserScriptIpcCube {
  bands: Float32Array[];
  height: number;
  width: number;
  wavelengths: number[] | null;
}

export type RunUserScriptIpcSource =
  | { mode: "formula"; expression: string }
  | { mode: "import" };

export interface RunUserScriptIpcRequest {
  cube: RunUserScriptIpcCube;
  source: RunUserScriptIpcSource;
}

export type RunUserScriptIpcResult =
  | { status: "completed"; value: JsonValue }
  | { status: "canceled" }
  | { status: "failed"; message: string };

export function registerRunUserScriptIpcHandler(): void {
  ipcMain.handle(RUN_USER_SCRIPT_CHANNEL, (event, request: RunUserScriptIpcRequest) =>
    handleRunUserScriptIpc(event, request),
  );
}

async function handleRunUserScriptIpc(
  event: Electron.IpcMainInvokeEvent,
  request: RunUserScriptIpcRequest,
): Promise<RunUserScriptIpcResult> {
  try {
    return await runUserScriptForRequest(findWindowForIpcEvent(event), request);
  } catch (error) {
    return { status: "failed", message: describeUserScriptFailure(error) };
  }
}

async function runUserScriptForRequest(
  window: BrowserWindow | null,
  request: RunUserScriptIpcRequest,
): Promise<RunUserScriptIpcResult> {
  const selection = resolveInterpreterSelectionOrThrow();
  const prepared = await prepareUserScriptInputOrCancel(window, request.source);
  if (prepared === null) return { status: "canceled" };
  return runPreparedUserScript(selection, prepared, request.cube);
}

function resolveInterpreterSelectionOrThrow(): PythonInterpreterSelection {
  return resolvePythonInterpreterSelection(
    buildInterpreterResolutionEnvironment(getConfiguredOwnInterpreterPath()),
  );
}

async function prepareUserScriptInputOrCancel(
  window: BrowserWindow | null,
  source: RunUserScriptIpcSource,
): Promise<PreparedImportedScript | null> {
  if (source.mode === "formula") {
    return { input: { kind: "formula", expression: source.expression }, releaseResources: releaseNothing };
  }
  return prepareImportedUserScriptFromDialog(window);
}

async function prepareImportedUserScriptFromDialog(
  window: BrowserWindow | null,
): Promise<PreparedImportedScript | null> {
  const filePath = await chooseImportedScriptFilePathOrNull(window);
  if (filePath === null) return null;
  return prepareImportedUserScriptFromFilePath(filePath);
}

async function chooseImportedScriptFilePathOrNull(
  window: BrowserWindow | null,
): Promise<string | null> {
  if (!window) return null;
  const result = await showOpenDialogOrStub(window, {
    title: "Import Script",
    properties: ["openFile"],
    filters: [IMPORTED_SCRIPT_FILE_FILTER],
  });
  const [firstPath] = result.filePaths;
  return result.canceled || firstPath === undefined ? null : firstPath;
}

async function runPreparedUserScript(
  selection: PythonInterpreterSelection,
  prepared: PreparedImportedScript,
  cube: RunUserScriptIpcCube,
): Promise<RunUserScriptIpcResult> {
  try {
    const outcome = await runUserScriptInPythonSubprocess({
      interpreterPath: selection.interpreterPath,
      input: prepared.input,
      cube: encodeCubeAsFloat32Payload(toCubeForUserScript(cube)),
      sandbox: !selection.isOwnEnvironmentMode,
      timeoutMs: USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS,
    });
    return mapWorkerOutcomeToIpcResult(outcome);
  } finally {
    await prepared.releaseResources();
  }
}

function toCubeForUserScript(cube: RunUserScriptIpcCube): CubeForUserScript {
  return {
    bands: cube.bands,
    height: cube.height,
    width: cube.width,
    wavelengths: cube.wavelengths,
  };
}

function mapWorkerOutcomeToIpcResult(outcome: PythonWorkerOutcome): RunUserScriptIpcResult {
  if (outcome.kind === "completed") return { status: "completed", value: outcome.value };
  return { status: "failed", message: outcome.userFacingMessage };
}

function describeUserScriptFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findWindowForIpcEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function releaseNothing(): Promise<void> {
  return Promise.resolve();
}
