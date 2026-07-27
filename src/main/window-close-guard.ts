import { BrowserWindow, ipcMain } from "electron";

// CT-258: closing the window must not silently discard unsaved work. Main
// intercepts the window's close event and asks the renderer first; the
// renderer decides (clean session closes immediately, dirty session shows the
// save-before-close dialog) and confirms through app:confirm-close, which
// flags the window so the follow-up close passes through untouched. The
// confirmed close is a regular BrowserWindow.close() so close-event listeners
// (window-state persistence) still run. Only the close event is intercepted;
// dev-mode reload and DevTools are unaffected.

const CLOSE_REQUESTED_CHANNEL = "menu:close-requested";
const CONFIRM_CLOSE_CHANNEL = "app:confirm-close";

const windowsConfirmedToClose = new WeakSet<BrowserWindow>();

export function interceptWindowCloseUntilRendererConfirms(window: BrowserWindow): void {
  window.on("close", (event) => askRendererBeforeClosing(window, event));
}

function askRendererBeforeClosing(window: BrowserWindow, event: Electron.Event): void {
  if (shouldLetWindowCloseWithoutAsking(window)) return;
  event.preventDefault();
  window.webContents.send(CLOSE_REQUESTED_CHANNEL);
}

// A crashed renderer can never answer the close request; holding the window
// hostage would make the app unclosable, so let that close through.
function shouldLetWindowCloseWithoutAsking(window: BrowserWindow): boolean {
  if (windowsConfirmedToClose.has(window)) return true;
  return window.webContents.isDestroyed() || window.webContents.isCrashed();
}

export function registerConfirmCloseIpcHandler(): void {
  ipcMain.handle(CONFIRM_CLOSE_CHANNEL, (event) => {
    closeWindowConfirmedByRenderer(BrowserWindow.fromWebContents(event.sender));
  });
}

function closeWindowConfirmedByRenderer(window: BrowserWindow | null): void {
  if (window === null || window.isDestroyed()) return;
  windowsConfirmedToClose.add(window);
  window.close();
}
