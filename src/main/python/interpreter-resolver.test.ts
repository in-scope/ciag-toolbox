import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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

// CT-262: Wallace suspected his local virtual environments interfered with the
// packaged app. Bundled mode must never consult PATH or any user Python
// environment: the only candidate the resolver may test is the interpreter
// inside the bundled runtime root, and a missing runtime must throw rather
// than fall back to anything else on the machine.
describe("bundled mode never consults PATH or user Python environments", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubUserPythonEnvironmentVariables(): void {
    vi.stubEnv("PATH", join("C:", "some-other-python"));
    vi.stubEnv("VIRTUAL_ENV", join("C:", "users", "wallace", ".venv"));
    vi.stubEnv("PYTHONHOME", join("C:", "python-home"));
  }

  it("consults only the interpreter path inside the bundled runtime root", () => {
    stubUserPythonEnvironmentVariables();
    for (const [isPackagedApp, runtimeRoot] of [
      [false, join("C:", "repo", ".python")],
      [true, join("C:", "app", "resources", "python")],
    ] as const) {
      const consultedPaths: string[] = [];
      const environment = environmentWhereEverythingExists({
        isPackagedApp,
        fileExists: (candidatePath) => {
          consultedPaths.push(candidatePath);
          return true;
        },
      });
      const resolvedPath = resolveActivePythonInterpreterPath(environment);
      expect(consultedPaths).toEqual([join(runtimeRoot, "python.exe")]);
      expect(resolvedPath).toBe(join(runtimeRoot, "python.exe"));
    }
  });

  it("throws instead of falling back to PATH when the packaged runtime is missing", () => {
    stubUserPythonEnvironmentVariables();
    const consultedPaths: string[] = [];
    const environment = environmentWhereEverythingExists({
      isPackagedApp: true,
      fileExists: (candidatePath) => {
        consultedPaths.push(candidatePath);
        return false;
      },
    });
    expect(() => resolveActivePythonInterpreterPath(environment)).toThrow(
      PythonInterpreterNotFoundError,
    );
    expect(consultedPaths).toEqual([join("C:", "app", "resources", "python", "python.exe")]);
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
