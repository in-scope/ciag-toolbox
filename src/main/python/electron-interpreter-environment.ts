import { app } from "electron";
import { existsSync } from "node:fs";

import type { InterpreterResolutionEnvironment } from "./interpreter-resolver";

// The Electron-aware builder for the interpreter resolver's injected environment.
// It is the ONE place that reaches for Electron globals (app.isPackaged,
// process.resourcesPath, app.getAppPath), so the resolver itself stays pure and
// unit-testable. Kept out of any module that Vitest imports directly, because an
// `electron` import breaks the node-environment tests (CT-208a note).
export function buildInterpreterResolutionEnvironment(
  configuredOwnEnvironmentInterpreterPath: string | null,
): InterpreterResolutionEnvironment {
  return {
    isPackagedApp: app.isPackaged,
    packagedResourcesPath: process.resourcesPath,
    developmentRepoRootPath: app.getAppPath(),
    platform: process.platform,
    fileExists: existsSync,
    configuredOwnEnvironmentInterpreterPath,
  };
}
