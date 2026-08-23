const INSTALLED_APP_USER_MODEL_ID = "sh.inscope.ciag.toolbox";
const DEVELOPMENT_APP_USER_MODEL_ID = "sh.inscope.ciag.toolbox.dev";

// A dev instance must not share the installed build's AppUserModelId: when a
// Start Menu shortcut carries the same id, the Windows taskbar shows that
// shortcut's (stale) exe icon instead of the live window icon.
export function chooseAppUserModelIdForTaskbarGrouping(
  isRunningInDevelopment: boolean,
): string {
  if (isRunningInDevelopment) return DEVELOPMENT_APP_USER_MODEL_ID;
  return INSTALLED_APP_USER_MODEL_ID;
}
