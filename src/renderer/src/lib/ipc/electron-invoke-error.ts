// ipcMain.handle rejections reach the renderer wrapped as
// "Error invoking remote method '<channel>': Error: <message>"; strip that
// harness prefix so toasts show only the human message.
const ELECTRON_INVOKE_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;

export function describeElectronInvokeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(ELECTRON_INVOKE_ERROR_PREFIX, "");
}
