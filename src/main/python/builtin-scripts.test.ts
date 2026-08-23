import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BuiltinScriptsNotFoundError,
  builtinScriptModuleNameOrThrow,
  resolveBuiltinScriptsDirectory,
  type BuiltinScriptResolutionEnvironment,
} from "./builtin-scripts";

function buildEnvironment(
  overrides: Partial<BuiltinScriptResolutionEnvironment> = {},
): BuiltinScriptResolutionEnvironment {
  return {
    isPackagedApp: false,
    packagedResourcesPath: join("C:", "app", "resources"),
    developmentRepoRootPath: join("C:", "repo"),
    fileExists: () => true,
    ...overrides,
  };
}

describe("resolveBuiltinScriptsDirectory", () => {
  it("resolves the repo's resources/builtin-python in development", () => {
    expect(resolveBuiltinScriptsDirectory(buildEnvironment())).toBe(
      join("C:", "repo", "resources", "builtin-python"),
    );
  });

  it("resolves resourcesPath/builtin-python in a packaged app", () => {
    expect(resolveBuiltinScriptsDirectory(buildEnvironment({ isPackagedApp: true }))).toBe(
      join("C:", "app", "resources", "builtin-python"),
    );
  });

  it("throws a clear error when the directory is missing", () => {
    expect(() =>
      resolveBuiltinScriptsDirectory(buildEnvironment({ fileExists: () => false })),
    ).toThrow(BuiltinScriptsNotFoundError);
  });
});

describe("builtinScriptModuleNameOrThrow", () => {
  it("accepts every catalogued built-in script name", () => {
    for (const name of ["npc", "rop", "local_pca", "local_mnf", "l2_minimization"]) {
      expect(builtinScriptModuleNameOrThrow(name)).toBe(name);
    }
  });

  it("refuses an uncatalogued name so a path can never be smuggled in", () => {
    expect(() => builtinScriptModuleNameOrThrow("../evil")).toThrow(/Unknown built-in script/);
    expect(() => builtinScriptModuleNameOrThrow("os")).toThrow(/Unknown built-in script/);
  });
});
