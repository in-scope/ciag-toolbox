// The single place that knows where the active Python interpreter lives.
// Development: the repo-local .python/ runtime installed by scripts/setup-python-runtime.mjs.
// Packaged: the runtime shipped under process.resourcesPath via electron-builder extraResources.
// Own-environment mode (CT-208e): when the user configures their own interpreter path,
// this resolver prefers it and reports the selection as own-environment (unsandboxed).
// Nothing else in the app may hardcode an interpreter path.
import { join } from "node:path";

export interface InterpreterResolutionEnvironment {
  isPackagedApp: boolean;
  packagedResourcesPath: string;
  developmentRepoRootPath: string;
  platform: NodeJS.Platform;
  fileExists: (candidatePath: string) => boolean;
  configuredOwnEnvironmentInterpreterPath?: string | null;
}

export interface PythonInterpreterSelection {
  interpreterPath: string;
  isOwnEnvironmentMode: boolean;
}

export class PythonInterpreterNotFoundError extends Error {
  constructor(searchedPath: string) {
    super(
      `The bundled Python runtime could not be found (looked in ${searchedPath}). ` +
        `Reinstall MSI Toolbox, or in development run: node scripts/setup-python-runtime.mjs`,
    );
    this.name = "PythonInterpreterNotFoundError";
  }
}

export class ConfiguredPythonInterpreterNotFoundError extends Error {
  constructor(configuredPath: string) {
    super(
      `Your configured Python interpreter could not be found (looked at ${configuredPath}). ` +
        `Fix the path in the Python environment settings, or clear it to use the bundled runtime.`,
    );
    this.name = "ConfiguredPythonInterpreterNotFoundError";
  }
}

function interpreterRelativePathForPlatform(platform: NodeJS.Platform): string {
  return platform === "win32" ? "python.exe" : join("bin", "python3");
}

function bundledRuntimeRootPath(environment: InterpreterResolutionEnvironment): string {
  return environment.isPackagedApp
    ? join(environment.packagedResourcesPath, "python")
    : join(environment.developmentRepoRootPath, ".python");
}

export function isOwnEnvironmentInterpreterConfigured(
  configuredPath: string | null | undefined,
): configuredPath is string {
  return typeof configuredPath === "string" && configuredPath.trim().length > 0;
}

function resolveBundledInterpreterSelection(
  environment: InterpreterResolutionEnvironment,
): PythonInterpreterSelection {
  const interpreterPath = join(
    bundledRuntimeRootPath(environment),
    interpreterRelativePathForPlatform(environment.platform),
  );
  if (!environment.fileExists(interpreterPath)) {
    throw new PythonInterpreterNotFoundError(interpreterPath);
  }
  return { interpreterPath, isOwnEnvironmentMode: false };
}

function resolveOwnEnvironmentInterpreterSelection(
  environment: InterpreterResolutionEnvironment,
  configuredPath: string,
): PythonInterpreterSelection {
  if (!environment.fileExists(configuredPath)) {
    throw new ConfiguredPythonInterpreterNotFoundError(configuredPath);
  }
  return { interpreterPath: configuredPath, isOwnEnvironmentMode: true };
}

export function resolvePythonInterpreterSelection(
  environment: InterpreterResolutionEnvironment,
): PythonInterpreterSelection {
  const configuredPath = environment.configuredOwnEnvironmentInterpreterPath;
  if (isOwnEnvironmentInterpreterConfigured(configuredPath)) {
    return resolveOwnEnvironmentInterpreterSelection(environment, configuredPath);
  }
  return resolveBundledInterpreterSelection(environment);
}

export function resolveActivePythonInterpreterPath(
  environment: InterpreterResolutionEnvironment,
): string {
  return resolvePythonInterpreterSelection(environment).interpreterPath;
}
