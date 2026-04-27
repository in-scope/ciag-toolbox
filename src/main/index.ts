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
import { registerOpenImageDialogIpcHandler } from "./open-image-dialog";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function buildPreloadScriptPath(): string {
  return join(__dirname, "../preload/index.js");
}

function buildRendererIndexHtmlPath(): string {
  return join(__dirname, "../renderer/index.html");
}

function isRunningInDevelopment(): boolean {
  return Boolean(process.env["ELECTRON_RENDERER_URL"]);
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
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: buildPreloadScriptPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

function maximizeWindowIfPreviouslyMaximized(
  window: BrowserWindow,
  bounds: WindowBounds,
): void {
  if (bounds.isMaximized) window.maximize();
}

function createMainWindow(): BrowserWindow {
  const savedBounds = loadSavedWindowBounds();
  const window = new BrowserWindow(buildBrowserWindowOptionsFrom(savedBounds));
  maximizeWindowIfPreviouslyMaximized(window, savedBounds);
  window.on("ready-to-show", () => window.show());
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
    createMainWindow();
  }
}

function quitWhenAllWindowsClosed(): void {
  if (process.platform !== "darwin") {
    app.quit();
  }
}

app.whenReady().then(() => {
  registerAppInfoIpcHandler();
  registerOpenImageDialogIpcHandler();
  createMainWindow();
  app.on("activate", reopenWindowOnMacActivate);
});

app.on("window-all-closed", quitWhenAllWindowsClosed);
