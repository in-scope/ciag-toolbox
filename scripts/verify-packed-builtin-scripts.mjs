// Verifies that a packed app directory contains the built-in algorithm
// scripts (CT-307, the CT-262 pattern): electron-builder treats a missing
// extraResources source as a WARNING only, so a build machine whose
// resources/builtin-python is absent or incomplete would ship an app whose
// Stage 6 algorithms all fail at runtime. This check turns that silent gap
// into a build failure. Used by scripts/after-pack.mjs and runnable standalone:
//   node scripts/verify-packed-builtin-scripts.mjs <appOutDir>
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILTIN_SCRIPTS_SOURCE_DIRECTORY = join(REPO_ROOT, "resources", "builtin-python");

function packedResourcesDirectory(appOutDir, electronPlatformName, productFilename) {
  if (electronPlatformName === "darwin") {
    return join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
  }
  return join(appOutDir, "resources");
}

function listExpectedBuiltinScriptFileNames() {
  const fileNames = readdirSync(BUILTIN_SCRIPTS_SOURCE_DIRECTORY).filter((name) =>
    name.endsWith(".py"),
  );
  if (fileNames.length === 0) {
    throw new Error(`No built-in scripts found in ${BUILTIN_SCRIPTS_SOURCE_DIRECTORY}`);
  }
  return fileNames;
}

export function listMissingPackedBuiltinScriptPaths({
  appOutDir,
  electronPlatformName,
  productFilename,
}) {
  const packedDirectory = join(
    packedResourcesDirectory(appOutDir, electronPlatformName, productFilename),
    "builtin-python",
  );
  if (!existsSync(packedDirectory)) return [packedDirectory];
  return listExpectedBuiltinScriptFileNames()
    .map((fileName) => join(packedDirectory, fileName))
    .filter((packedPath) => !existsSync(packedPath));
}

export function assertPackedAppContainsBuiltinScripts(packedAppDescription) {
  const missingPaths = listMissingPackedBuiltinScriptPaths(packedAppDescription);
  if (missingPaths.length === 0) {
    console.log(`Built-in algorithm scripts verified in ${packedAppDescription.appOutDir}`);
    return;
  }
  throw new Error(
    `The packed app at ${packedAppDescription.appOutDir} is missing built-in algorithm ` +
      `scripts (missing: ${missingPaths.join(", ")}). Check resources/builtin-python and ` +
      `the extraResources entry in electron-builder.yml.`,
  );
}

function electronPlatformNameForThisMachine() {
  return process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux";
}

function runCommandLineVerification() {
  const appOutDir = process.argv[2];
  if (appOutDir === undefined) {
    throw new Error("Usage: node scripts/verify-packed-builtin-scripts.mjs <appOutDir>");
  }
  assertPackedAppContainsBuiltinScripts({
    appOutDir: resolve(appOutDir),
    electronPlatformName: electronPlatformNameForThisMachine(),
    productFilename: "CHARM Toolbox",
  });
}

const isRunDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isRunDirectly) runCommandLineVerification();
