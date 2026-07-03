// electron-builder afterPack hook: code-signs the bundled Python runtime's
// Mach-O binaries (interpreter executables, .dylib/.so extension modules)
// inside-out BEFORE electron-builder signs the outer app bundle, which macOS
// notarization requires. No-op on non-macOS builds and when no runtime is bundled.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTITLEMENTS_PATH = resolve(PROJECT_ROOT, "build", "entitlements.mac.plist");
const SIGNABLE_EXTENSIONS = [".so", ".dylib"];

function signingIdentity() {
  return process.env.MSI_MAC_SIGNING_IDENTITY ?? process.env.CSC_NAME ?? "-";
}

function bundledPythonRuntimeDir(context) {
  const appBundleName = `${context.packager.appInfo.productFilename}.app`;
  return join(context.appOutDir, appBundleName, "Contents", "Resources", "python");
}

async function listFilePathsRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

function isSignableRuntimeBinary(filePath) {
  if (SIGNABLE_EXTENSIONS.some((extension) => filePath.endsWith(extension))) return true;
  return dirname(filePath).endsWith(join("python", "bin"));
}

function codesignRuntimeBinary(filePath, identity) {
  execFileSync(
    "codesign",
    ["--force", "--sign", identity, "--options", "runtime", "--timestamp", "--entitlements", ENTITLEMENTS_PATH, filePath],
    { stdio: "inherit" },
  );
}

export default async function signBundledPythonRuntimeBinaries(context) {
  if (context.electronPlatformName !== "darwin") return;
  const runtimeDir = bundledPythonRuntimeDir(context);
  if (!existsSync(runtimeDir)) return;
  const allFilePaths = await listFilePathsRecursively(runtimeDir);
  const signablePaths = allFilePaths.filter(isSignableRuntimeBinary);
  const identity = signingIdentity();
  console.log(`Signing ${signablePaths.length} bundled Python binaries (identity: ${identity})`);
  for (const filePath of signablePaths) codesignRuntimeBinary(filePath, identity);
}
