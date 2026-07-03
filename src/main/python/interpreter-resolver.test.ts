import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PythonInterpreterNotFoundError,
  resolveActivePythonInterpreterPath,
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
});
