import { app } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PYTHON_ENVIRONMENT_STATE_FILE_NAME = "python-environment.json";

function getPythonEnvironmentStateFilePath(): string {
  return join(app.getPath("userData"), PYTHON_ENVIRONMENT_STATE_FILE_NAME);
}

function readOwnInterpreterPathFromJson(json: string): string | null {
  const data = JSON.parse(json) as { ownInterpreterPath?: unknown };
  return typeof data.ownInterpreterPath === "string" ? data.ownInterpreterPath : null;
}

export function loadSavedOwnInterpreterPath(): string | null {
  const path = getPythonEnvironmentStateFilePath();
  if (!existsSync(path)) return null;
  try {
    return readOwnInterpreterPathFromJson(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export function persistOwnInterpreterPathToDisk(ownInterpreterPath: string | null): void {
  try {
    const path = getPythonEnvironmentStateFilePath();
    writeFileSync(path, JSON.stringify({ ownInterpreterPath }));
  } catch {
    // best-effort persistence; do not block the settings dialog on a failed write
  }
}
