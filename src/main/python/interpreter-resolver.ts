// The single place that knows where the active Python interpreter lives.
// Development: the repo-local .python/ runtime installed by scripts/setup-python-runtime.mjs.
// Packaged: the runtime shipped under process.resourcesPath via electron-builder extraResources.
// Nothing else in the app may hardcode an interpreter path; CT-208e extends this
// resolver with the opt-in own-environment interpreter preference.
import { join } from "node:path";

export interface InterpreterResolutionEnvironment {
  isPackagedApp: boolean;
  packagedResourcesPath: string;
  developmentRepoRootPath: string;
  platform: NodeJS.Platform;
  fileExists: (candidatePath: string) => boolean;
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

function interpreterRelativePathForPlatform(platform: NodeJS.Platform): string {
  return platform === "win32" ? "python.exe" : join("bin", "python3");
}

function bundledRuntimeRootPath(environment: InterpreterResolutionEnvironment): string {
  return environment.isPackagedApp
    ? join(environment.packagedResourcesPath, "python")
    : join(environment.developmentRepoRootPath, ".python");
}

export function resolveActivePythonInterpreterPath(
  environment: InterpreterResolutionEnvironment,
): string {
  const interpreterPath = join(
    bundledRuntimeRootPath(environment),
    interpreterRelativePathForPlatform(environment.platform),
  );
  if (!environment.fileExists(interpreterPath)) {
    throw new PythonInterpreterNotFoundError(interpreterPath);
  }
  return interpreterPath;
}
