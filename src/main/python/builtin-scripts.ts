// The single place that knows where the built-in algorithm scripts live (CT-307).
// Development: <repo>/resources/builtin-python. Packaged: shipped under
// process.resourcesPath/builtin-python via electron-builder extraResources
// (mirrors the interpreter-resolver.ts pattern; the afterPack hook asserts the
// scripts actually landed in the packed app). Electron-free so it unit-tests in
// the node environment; the IPC layer injects the environment.
import { join } from "node:path";

import {
  isBuiltinScriptName,
  type BuiltinScriptName,
} from "../../shared/chunked-user-script-run-protocol";

export const BUILTIN_PYTHON_SCRIPTS_DIRECTORY_NAME = "builtin-python";

export interface BuiltinScriptResolutionEnvironment {
  isPackagedApp: boolean;
  packagedResourcesPath: string;
  developmentRepoRootPath: string;
  fileExists: (candidatePath: string) => boolean;
}

export class BuiltinScriptsNotFoundError extends Error {
  constructor(searchedPath: string) {
    super(
      `The built-in algorithm scripts could not be found (looked in ${searchedPath}). ` +
        `Reinstall CHARM Toolbox, or in development check resources/builtin-python.`,
    );
    this.name = "BuiltinScriptsNotFoundError";
  }
}

export function resolveBuiltinScriptsDirectory(
  environment: BuiltinScriptResolutionEnvironment,
): string {
  const directory = environment.isPackagedApp
    ? join(environment.packagedResourcesPath, BUILTIN_PYTHON_SCRIPTS_DIRECTORY_NAME)
    : join(environment.developmentRepoRootPath, "resources", BUILTIN_PYTHON_SCRIPTS_DIRECTORY_NAME);
  if (!environment.fileExists(directory)) throw new BuiltinScriptsNotFoundError(directory);
  return directory;
}

// The renderer names a built-in script; only catalogued names resolve, so a
// begin request can never smuggle a path or an arbitrary module name.
export function builtinScriptModuleNameOrThrow(scriptName: string): BuiltinScriptName {
  if (!isBuiltinScriptName(scriptName)) {
    throw new Error(`Unknown built-in script: ${scriptName}`);
  }
  return scriptName;
}
