import { app, BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 800;

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

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: buildPreloadScriptPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.on("ready-to-show", () => window.show());
  attachExternalLinkHandler(window);
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
  createMainWindow();
  app.on("activate", reopenWindowOnMacActivate);
});

app.on("window-all-closed", quitWhenAllWindowsClosed);
