// Pure logic behind the Python environment settings dialog (CT-208e).
// Own-environment mode is opt-in and TRUSTED: when the user points the toolbox at
// their own interpreter, user scripts run unsandboxed (the wall-clock + memory kill
// switch still applies). With no configured path, scripts run against the bundled
// runtime in the sandboxed bundled mode (CT-208d).

export interface PythonEnvironmentSnapshot {
  ownInterpreterPath: string | null;
  pathExists: boolean;
}

export type PythonEnvironmentStatus =
  | { mode: "bundled" }
  | { mode: "own-valid"; interpreterPath: string }
  | { mode: "own-missing"; interpreterPath: string };

export function normalizeOwnInterpreterPathInput(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isOwnEnvironmentModeActive(snapshot: PythonEnvironmentSnapshot): boolean {
  return snapshot.ownInterpreterPath !== null;
}

export function shouldSandboxUserScriptInEnvironment(
  snapshot: PythonEnvironmentSnapshot,
): boolean {
  return !isOwnEnvironmentModeActive(snapshot);
}

export function describePythonEnvironmentStatus(
  snapshot: PythonEnvironmentSnapshot,
): PythonEnvironmentStatus {
  if (snapshot.ownInterpreterPath === null) return { mode: "bundled" };
  if (snapshot.pathExists) {
    return { mode: "own-valid", interpreterPath: snapshot.ownInterpreterPath };
  }
  return { mode: "own-missing", interpreterPath: snapshot.ownInterpreterPath };
}
