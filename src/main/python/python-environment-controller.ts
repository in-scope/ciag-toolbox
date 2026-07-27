import { ipcMain } from "electron";
import { existsSync } from "node:fs";
import {
  loadSavedOwnInterpreterPath,
  persistOwnInterpreterPathToDisk,
} from "./python-environment-state";

// The current own-environment interpreter preference (CT-208e), held in the main
// process. When set, the CT-208a resolver prefers it and user scripts run unsandboxed.
export interface PythonEnvironmentSnapshot {
  ownInterpreterPath: string | null;
  pathExists: boolean;
}

const PYTHON_ENVIRONMENT_GET_CHANNEL = "python-environment:get";
const PYTHON_ENVIRONMENT_SET_CHANNEL = "python-environment:set";

let currentOwnInterpreterPath: string | null = null;

export function getConfiguredOwnInterpreterPath(): string | null {
  return currentOwnInterpreterPath;
}

function normalizeConfiguredInterpreterPath(rawPath: unknown): string | null {
  if (typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readCurrentPythonEnvironmentSnapshot(): PythonEnvironmentSnapshot {
  return {
    ownInterpreterPath: currentOwnInterpreterPath,
    pathExists: currentOwnInterpreterPath !== null && existsSync(currentOwnInterpreterPath),
  };
}

function applyConfiguredInterpreterPath(rawPath: unknown): PythonEnvironmentSnapshot {
  currentOwnInterpreterPath = normalizeConfiguredInterpreterPath(rawPath);
  persistOwnInterpreterPathToDisk(currentOwnInterpreterPath);
  return readCurrentPythonEnvironmentSnapshot();
}

function registerPythonEnvironmentGetHandler(): void {
  ipcMain.handle(PYTHON_ENVIRONMENT_GET_CHANNEL, () =>
    readCurrentPythonEnvironmentSnapshot(),
  );
}

function registerPythonEnvironmentSetHandler(): void {
  ipcMain.handle(PYTHON_ENVIRONMENT_SET_CHANNEL, (_event, rawPath: unknown) =>
    applyConfiguredInterpreterPath(rawPath),
  );
}

export function initializePythonEnvironmentControllerFromDisk(): void {
  currentOwnInterpreterPath = loadSavedOwnInterpreterPath();
  registerPythonEnvironmentGetHandler();
  registerPythonEnvironmentSetHandler();
}
