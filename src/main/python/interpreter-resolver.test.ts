import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ConfiguredPythonInterpreterNotFoundError,
  PythonInterpreterNotFoundError,
  isOwnEnvironmentInterpreterConfigured,
  resolveActivePythonInterpreterPath,
  resolvePythonInterpreterSelection,
  type InterpreterResolutionEnvironment,
} from "./interpreter-resolver";

function environmentWhereEverythingExists(
  overrides: Partial<InterpreterResolutionEnvironment>,
): InterpreterResolutionEnvironment {
  return {
    isPackagedApp: false,
    packagedResourcesPath: join("C:", "app", "resources"),
    developmentRepoRootPath: join("C:", "repo"),
    platform: "win32",
    fileExists: () => true,
    ...overrides,
  };
}

describe("resolveActivePythonInterpreterPath", () => {
  it("resolves the repo-local .python interpreter in development on Windows", () => {
    const path = resolveActivePythonInterpreterPath(environmentWhereEverythingExists({}));
    expect(path).toBe(join("C:", "repo", ".python", "python.exe"));
  });

  it("resolves the repo-local .python bin interpreter in development on macOS", () => {
    const path = resolveActivePythonInterpreterPath(
      environmentWhereEverythingExists({ platform: "darwin" }),
    );
    expect(path).toBe(join("C:", "repo", ".python", "bin", "python3"));
  });

  it("resolves under the packaged resources path in packaged builds", () => {
    const path = resolveActivePythonInterpreterPath(
      environmentWhereEverythingExists({ isPackagedApp: true }),
    );
    expect(path).toBe(join("C:", "app", "resources", "python", "python.exe"));
  });

  it("throws a user-facing error naming the searched path when no interpreter exists", () => {
    const environment = environmentWhereEverythingExists({ fileExists: () => false });
    expect(() => resolveActivePythonInterpreterPath(environment)).toThrow(
      PythonInterpreterNotFoundError,
    );
    expect(() => resolveActivePythonInterpreterPath(environment)).toThrow(
      /could not be found.*\.python.*setup-python-runtime/s,
    );
  });

  it("prefers the configured own-environment interpreter when set and it exists", () => {
    const ownPath = join("C:", "venv", "Scripts", "python.exe");
    const path = resolveActivePythonInterpreterPath(
      environmentWhereEverythingExists({ configuredOwnEnvironmentInterpreterPath: ownPath }),
    );
    expect(path).toBe(ownPath);
  });

  it("falls back to the bundled interpreter when no own-environment path is configured", () => {
    for (const configuredOwnEnvironmentInterpreterPath of [null, undefined, "", "   "]) {
      const path = resolveActivePythonInterpreterPath(
        environmentWhereEverythingExists({ configuredOwnEnvironmentInterpreterPath }),
      );
      expect(path).toBe(join("C:", "repo", ".python", "python.exe"));
    }
  });

  it("surfaces a clear user-facing error when the configured interpreter path is invalid", () => {
    const ownPath = join("C:", "venv", "missing-python.exe");
    const environment = environmentWhereEverythingExists({
      configuredOwnEnvironmentInterpreterPath: ownPath,
      fileExists: (candidate) => candidate !== ownPath,
    });
    expect(() => resolveActivePythonInterpreterPath(environment)).toThrow(
      ConfiguredPythonInterpreterNotFoundError,
    );
    expect(() => resolveActivePythonInterpreterPath(environment)).toThrow(
      /configured Python interpreter could not be found.*missing-python/s,
    );
  });
});

describe("resolvePythonInterpreterSelection", () => {
  it("reports own-environment mode only when a configured interpreter is used", () => {
    const ownPath = join("C:", "venv", "bin", "python3");
    const own = resolvePythonInterpreterSelection(
      environmentWhereEverythingExists({
        platform: "darwin",
        configuredOwnEnvironmentInterpreterPath: ownPath,
      }),
    );
    expect(own).toEqual({ interpreterPath: ownPath, isOwnEnvironmentMode: true });
    const bundled = resolvePythonInterpreterSelection(environmentWhereEverythingExists({}));
    expect(bundled.isOwnEnvironmentMode).toBe(false);
  });
});

describe("isOwnEnvironmentInterpreterConfigured", () => {
  it("treats only a non-blank string as a configured own-environment path", () => {
    expect(isOwnEnvironmentInterpreterConfigured("C:/venv/python.exe")).toBe(true);
    expect(isOwnEnvironmentInterpreterConfigured("   ")).toBe(false);
    expect(isOwnEnvironmentInterpreterConfigured("")).toBe(false);
    expect(isOwnEnvironmentInterpreterConfigured(null)).toBe(false);
    expect(isOwnEnvironmentInterpreterConfigured(undefined)).toBe(false);
  });
});
