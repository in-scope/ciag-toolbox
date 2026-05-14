import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SPLASH_WINDOW_WIDTH_IN_PIXELS = 460;
const SPLASH_WINDOW_HEIGHT_IN_PIXELS = 280;
const MINIMUM_SPLASH_DISPLAY_DURATION_MS = 2000;

export interface SplashWindowHandle {
  waitUntilMinimumDisplayDurationElapsed(): Promise<void>;
  dismiss(): void;
}

function buildSplashFileUrlForProductionRenderer(): string {
  const filePath = join(__dirname, "../renderer/splash.html");
  return `file:///${filePath.replace(/\\/g, "/")}`;
}

function buildSplashUrlForActiveEnvironment(): string {
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl !== undefined) return `${devServerUrl}/splash.html`;
  return buildSplashFileUrlForProductionRenderer();
}

function appendVersionHashToSplashUrl(baseUrl: string): string {
  const versionHash = encodeURIComponent(app.getVersion());
  return `${baseUrl}#${versionHash}`;
}

function buildSplashBrowserWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    width: SPLASH_WINDOW_WIDTH_IN_PIXELS,
    height: SPLASH_WINDOW_HEIGHT_IN_PIXELS,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

function delayUntilTimestamp(targetTimestamp: number): Promise<void> {
  const remainingMilliseconds = Math.max(0, targetTimestamp - Date.now());
  return new Promise((resolve) => setTimeout(resolve, remainingMilliseconds));
}

function closeWindowIfStillAlive(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  window.close();
}

function startSplashLoadFromActiveEnvironment(window: BrowserWindow): void {
  const splashUrl = appendVersionHashToSplashUrl(buildSplashUrlForActiveEnvironment());
  void window.loadURL(splashUrl);
}

export function createSplashWindow(): SplashWindowHandle {
  const window = new BrowserWindow(buildSplashBrowserWindowOptions());
  const dismissalAllowedAt = Date.now() + MINIMUM_SPLASH_DISPLAY_DURATION_MS;
  window.once("ready-to-show", () => window.show());
  startSplashLoadFromActiveEnvironment(window);
  return {
    waitUntilMinimumDisplayDurationElapsed: () => delayUntilTimestamp(dismissalAllowedAt),
    dismiss: () => closeWindowIfStillAlive(window),
  };
}
