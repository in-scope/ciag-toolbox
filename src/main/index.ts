import { app, BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installApplicationMenu } from "./menu";
import {
  attachWindowStatePersistence,
  loadSavedWindowBounds,
  type WindowBounds,
} from "./window-state";
import { registerAppInfoIpcHandler } from "./app-info";
import {
  E2E_TEST_MODE_PRELOAD_ARGUMENT,
  isE2eTestModeEnabled,
  registerE2eDialogStubTestChannelsWhenEnabled,
} from "./e2e-dialog-stub";
import { registerOpenBundleDialogIpcHandlers } from "./open-bundle-dialog";
import { registerOpenImageDialogIpcHandler } from "./open-image-dialog";
import { registerChunkedOpenedImageReadIpcHandlers } from "./chunked-opened-image-read-ipc";
import { registerOpenImagesDialogIpcHandlers } from "./open-images-dialog";
import { registerSaveBundleDialogIpcHandlers } from "./save-bundle-dialog";
import { registerSaveImageDialogIpcHandlers } from "./save-image-dialog";
import { initializeThemeControllerFromDisk } from "./theme-controller";
import { initializePythonEnvironmentControllerFromDisk } from "./python/python-environment-controller";
import { registerRunUserScriptIpcHandler } from "./python/user-script-ipc";
import { registerRendererCrashLogging } from "./renderer-crash-logging";
import { createSplashWindow, type SplashWindowHandle } from "./splash-window";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CT-239 test surface (MSI_E2E only, like the dialog stubs): expose window.gc
// in every renderer so the scale10 sweep can deterministically release closed
// panels' cubes between full-scale applies. The renderer's ArrayBuffer pool is
// a hard ~17 GB cap and V8 does not run a last-resort collection when a
// backing-store allocation fails, so tests cannot rely on collection timing.
// No effect on production launches.
function exposeGarbageCollectionForE2eTestMode(): void {
  if (!isE2eTestModeEnabled()) return;
  app.commandLine.appendSwitch("js-flags", "--expose-gc");
}

exposeGarbageCollectionForE2eTestMode();

function buildPreloadScriptPath(): string {
  return join(__dirname, "../preload/index.js");
}

function buildRendererIndexHtmlPath(): string {
  return join(__dirname, "../renderer/index.html");
}

function isRunningInDevelopment(): boolean {
  return Boolean(process.env["ELECTRON_RENDERER_URL"]);
}

function resolveDevelopmentModeWindowIconPath(): string | undefined {
  if (!isRunningInDevelopment()) return undefined;
  return join(__dirname, "../../build/icon.ico");
}

function setWindowsAppUserModelIdForTaskbarGrouping(): void {
  if (process.platform !== "win32") return;
  app.setAppUserModelId("sh.inscope.ciag.toolbox");
}

function loadRendererIntoWindow(window: BrowserWindow): void {
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl);
    return;
  }
  void window.loadFile(buildRendererIndexHtmlPath());
}

function attachExternalLinkHandler(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

function buildBrowserWindowOptionsFrom(
  bounds: WindowBounds,
): Electron.BrowserWindowConstructorOptions {
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    icon: resolveDevelopmentModeWindowIconPath(),
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: buildPreloadScriptPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: buildPreloadAdditionalArguments(),
    },
  };
}

function buildPreloadAdditionalArguments(): string[] {
  return isE2eTestModeEnabled() ? [E2E_TEST_MODE_PRELOAD_ARGUMENT] : [];
}

function maximizeWindowIfPreviouslyMaximized(
  window: BrowserWindow,
  bounds: WindowBounds,
): void {
  if (bounds.isMaximized) window.maximize();
}

async function showMainWindowAfterSplashMinimumElapsed(
  mainWindow: BrowserWindow,
  splash: SplashWindowHandle | null,
): Promise<void> {
  if (splash !== null) await splash.waitUntilMinimumDisplayDurationElapsed();
  mainWindow.show();
  if (splash !== null) splash.dismiss();
}

function deferMainWindowShowUntilReadyAndSplashElapsed(
  mainWindow: BrowserWindow,
  splash: SplashWindowHandle | null,
): void {
  mainWindow.once("ready-to-show", () => {
    void showMainWindowAfterSplashMinimumElapsed(mainWindow, splash);
  });
}

function createMainWindow(splash: SplashWindowHandle | null): BrowserWindow {
  const savedBounds = loadSavedWindowBounds();
  const window = new BrowserWindow(buildBrowserWindowOptionsFrom(savedBounds));
  maximizeWindowIfPreviouslyMaximized(window, savedBounds);
  deferMainWindowShowUntilReadyAndSplashElapsed(window, splash);
  attachExternalLinkHandler(window);
  attachWindowStatePersistence(window);
  installApplicationMenu(window);
  loadRendererIntoWindow(window);
  if (isRunningInDevelopment()) {
    window.webContents.openDevTools({ mode: "detach" });
  }
  return window;
}

function reopenWindowOnMacActivate(): void {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow(null);
  }
}

function quitWhenAllWindowsClosed(): void {
  if (process.platform !== "darwin") {
    app.quit();
  }
}

app.whenReady().then(() => {
  registerRendererCrashLogging();
  setWindowsAppUserModelIdForTaskbarGrouping();
  initializeThemeControllerFromDisk();
  initializePythonEnvironmentControllerFromDisk();
  registerRunUserScriptIpcHandler();
  registerAppInfoIpcHandler();
  registerOpenImageDialogIpcHandler();
  registerOpenImagesDialogIpcHandlers();
  registerChunkedOpenedImageReadIpcHandlers();
  registerSaveImageDialogIpcHandlers();
  registerOpenBundleDialogIpcHandlers();
  registerSaveBundleDialogIpcHandlers();
  registerE2eDialogStubTestChannelsWhenEnabled();
  const splash = createSplashWindow();
  createMainWindow(splash);
  app.on("activate", reopenWindowOnMacActivate);
});

app.on("window-all-closed", quitWhenAllWindowsClosed);
