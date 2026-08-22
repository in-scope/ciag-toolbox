// electron-builder afterPack hook (CT-262): first FAIL the build if the bundled
// Python runtime did not make it into the packed app (a machine that never ran
// scripts/setup-python-runtime.mjs would otherwise ship an installer whose
// custom functions all error), then sign the runtime's binaries on macOS.
// CT-307: the built-in algorithm scripts get the same presence assertion.
import signBundledPythonRuntimeBinaries from "./sign-macos-python-runtime.mjs";
import { assertPackedAppContainsBuiltinScripts } from "./verify-packed-builtin-scripts.mjs";
import { assertPackedAppContainsPythonRuntime } from "./verify-packed-python-runtime.mjs";

export default async function verifyThenSignPackedPythonRuntime(context) {
  const packedAppDescription = {
    appOutDir: context.appOutDir,
    electronPlatformName: context.electronPlatformName,
    productFilename: context.packager.appInfo.productFilename,
  };
  assertPackedAppContainsPythonRuntime(packedAppDescription);
  assertPackedAppContainsBuiltinScripts(packedAppDescription);
  await signBundledPythonRuntimeBinaries(context);
}
