import { basename } from "node:path";

import { BrowserWindow, ipcMain } from "electron";

import { showOpenDialogOrStub } from "../e2e-dialog-stub";
import {
  createChunkedUserScriptRunSessionStore,
  type ChunkedUserScriptRunSessionStore,
  type ExecutableUserScriptRun,
} from "./chunked-user-script-run";
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
import { wallClockTimeoutMsForUserScriptResultKind } from "./user-script-timeouts";
import {
  USER_SCRIPT_RUN_BEGIN_CHANNEL,
  USER_SCRIPT_RUN_CUBE_CHUNK_CHANNEL,
  USER_SCRIPT_RUN_EXECUTE_CHANNEL,
  USER_SCRIPT_RUN_RELEASE_CHANNEL,
  USER_SCRIPT_RUN_RESULT_CHUNK_CHANNEL,
  type UserScriptRunBeginRequest,
  type UserScriptRunBeginResult,
  type UserScriptRunCubeChunkRequest,
  type UserScriptRunExecuteRequest,
  type UserScriptRunExecuteResult,
  type UserScriptRunReleaseRequest,
  type UserScriptRunResultChunkRequest,
  type UserScriptRunResultKind,
  type UserScriptRunSource,
} from "../../shared/chunked-user-script-run-protocol";

// CT-209/CT-210: the renderer's band-ops popups run a user formula or imported
// tool against the current stack. The interpreter selection, sandbox decision,
// import dialog, subprocess run, and temp cleanup all live here so the renderer
// only sends the cube and gets weights/bands back. Bundled mode is sandboxed;
// own-environment mode (CT-208e) runs trusted. CT-216: a resultKind of 'cube'
// (the Custom transform) returns the transformed whole cube and runs under the
// longer 120 s wall clock.
// CT-219g: the cube crosses IPC through the CHUNKED run protocol
// (src/shared/chunked-user-script-run-protocol.ts) instead of one whole-cube
// invoke, which wedged the renderer at reference scale. Session bookkeeping is
// the electron-free chunked-user-script-run.ts; this module wires the channels
// and owns everything that needs electron.

const IMPORTED_SCRIPT_FILE_FILTER: Electron.FileFilter = {
  name: "Python tool",
  extensions: ["py", "zip"],
};

interface PreparedUserScriptRun {
  prepared: PreparedImportedScript;
  sourceName: string | null;
}

export function registerRunUserScriptIpcHandler(): void {
  const sessions = createChunkedUserScriptRunSessionStore();
  ipcMain.handle(USER_SCRIPT_RUN_BEGIN_CHANNEL, (event, request: UserScriptRunBeginRequest) =>
    handleBeginUserScriptRun(sessions, event, request),
  );
  ipcMain.handle(USER_SCRIPT_RUN_CUBE_CHUNK_CHANNEL, (_event, request: UserScriptRunCubeChunkRequest) =>
    sessions.appendCubeChunk(request.token, request.bytes),
  );
  ipcMain.handle(USER_SCRIPT_RUN_EXECUTE_CHANNEL, (_event, request: UserScriptRunExecuteRequest) =>
    handleExecuteUserScriptRun(sessions, request.token),
  );
  ipcMain.handle(USER_SCRIPT_RUN_RESULT_CHUNK_CHANNEL, (_event, request: UserScriptRunResultChunkRequest) =>
    sessions.readNextResultChunk(request.token),
  );
  ipcMain.handle(USER_SCRIPT_RUN_RELEASE_CHANNEL, (_event, request: UserScriptRunReleaseRequest) =>
    sessions.release(request.token),
  );
}

async function handleBeginUserScriptRun(
  sessions: ChunkedUserScriptRunSessionStore,
  event: Electron.IpcMainInvokeEvent,
  request: UserScriptRunBeginRequest,
): Promise<UserScriptRunBeginResult> {
  try {
    const selection = resolveInterpreterSelectionOrThrow();
    const run = await prepareUserScriptInputOrCancel(findWindowForIpcEvent(event), request.source);
    if (run === null) return { status: "canceled" };
    return await beginSessionForPreparedRun(sessions, request, selection, run);
  } catch (error) {
    return { status: "failed", message: describeUserScriptFailure(error) };
  }
}

async function beginSessionForPreparedRun(
  sessions: ChunkedUserScriptRunSessionStore,
  request: UserScriptRunBeginRequest,
  selection: PythonInterpreterSelection,
  run: PreparedUserScriptRun,
): Promise<UserScriptRunBeginResult> {
  try {
    const token = await sessions.begin({
      cube: request.cube,
      resultKind: request.resultKind,
      input: run.prepared.input,
      releaseInputResources: run.prepared.releaseResources,
      sourceName: run.sourceName,
      interpreterPath: selection.interpreterPath,
      sandbox: !selection.isOwnEnvironmentMode,
    });
    return { status: "ready", token, sourceName: run.sourceName };
  } catch (error) {
    await run.prepared.releaseResources().catch(() => undefined);
    throw error;
  }
}

function resolveInterpreterSelectionOrThrow(): PythonInterpreterSelection {
  return resolvePythonInterpreterSelection(
    buildInterpreterResolutionEnvironment(getConfiguredOwnInterpreterPath()),
  );
}

async function prepareUserScriptInputOrCancel(
  window: BrowserWindow | null,
  source: UserScriptRunSource,
): Promise<PreparedUserScriptRun | null> {
  if (source.mode === "formula") {
    return {
      prepared: { input: { kind: "formula", expression: source.expression }, releaseResources: releaseNothing },
      sourceName: null,
    };
  }
  return prepareImportedUserScriptFromDialog(window);
}

async function prepareImportedUserScriptFromDialog(
  window: BrowserWindow | null,
): Promise<PreparedUserScriptRun | null> {
  const filePath = await chooseImportedScriptFilePathOrNull(window);
  if (filePath === null) return null;
  return { prepared: await prepareImportedUserScriptFromFilePath(filePath), sourceName: basename(filePath) };
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

async function handleExecuteUserScriptRun(
  sessions: ChunkedUserScriptRunSessionStore,
  token: string,
): Promise<UserScriptRunExecuteResult> {
  try {
    const run = sessions.takeExecutableRun(token);
    const outcome = await runExecutableUserScriptInSubprocess(run);
    return mapWorkerOutcomeToExecuteResult(sessions, token, run.resultKind, outcome);
  } catch (error) {
    return { status: "failed", message: describeUserScriptFailure(error) };
  } finally {
    await sessions.releaseInputResourcesAfterRun(token).catch(() => undefined);
  }
}

function runExecutableUserScriptInSubprocess(
  run: ExecutableUserScriptRun,
): Promise<PythonWorkerOutcome> {
  return runUserScriptInPythonSubprocess({
    interpreterPath: run.interpreterPath,
    input: run.input,
    cube: run.cube,
    resultKind: run.resultKind,
    cubeResultSpoolPath: run.cubeResultSpoolPath,
    sandbox: run.sandbox,
    timeoutMs: wallClockTimeoutMsForUserScriptResultKind(run.resultKind),
  });
}

function mapWorkerOutcomeToExecuteResult(
  sessions: ChunkedUserScriptRunSessionStore,
  token: string,
  resultKind: UserScriptRunResultKind,
  outcome: PythonWorkerOutcome,
): UserScriptRunExecuteResult {
  if (outcome.kind === "failed") return { status: "failed", message: outcome.userFacingMessage };
  if (outcome.kind === "completed-cube") {
    return mapCubeOutcomeToExecuteResult(sessions, token, resultKind, outcome);
  }
  return mapValueOutcomeToExecuteResult(resultKind, outcome);
}

// The worker's outcome kind is dictated by the requested resultKind, so a
// mismatch here is a harness bug surfaced as a plain failure.
function mapCubeOutcomeToExecuteResult(
  sessions: ChunkedUserScriptRunSessionStore,
  token: string,
  resultKind: UserScriptRunResultKind,
  outcome: Extract<PythonWorkerOutcome, { kind: "completed-cube" }>,
): UserScriptRunExecuteResult {
  if (resultKind !== "cube") {
    return { status: "failed", message: "The script returned an unexpected cube result." };
  }
  const stored = sessions.storeCubeResultForPull(token, outcome.shape, outcome.totalBytes);
  return { status: "completed-cube", shape: outcome.shape, totalBytes: stored.totalBytes };
}

function mapValueOutcomeToExecuteResult(
  resultKind: UserScriptRunResultKind,
  outcome: Extract<PythonWorkerOutcome, { kind: "completed" }>,
): UserScriptRunExecuteResult {
  if (resultKind !== "value") {
    return { status: "failed", message: "The script returned an unexpected non-cube result." };
  }
  return { status: "completed", value: outcome.value };
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
