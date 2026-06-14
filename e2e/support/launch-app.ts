import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
// Launch against the project root (not out/main/index.js directly) so Electron
// resolves the real package.json: app.getVersion()/getName() then report the
// production values instead of the Electron runtime version.
const APPLICATION_ROOT_PATH = resolve(currentDirectory, "..", "..");
const DEFAULT_RENDERER_DEV_SERVER_URL = "http://localhost:5173";
const WINDOW_POLL_INTERVAL_MS = 250;
const MAX_WINDOW_POLL_ATTEMPTS = 120;

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
}

function resolveRendererDevServerUrl(): string {
  return process.env["MSI_E2E_RENDERER_URL"] ?? DEFAULT_RENDERER_DEV_SERVER_URL;
}

function keepDefinedStringEntries(
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  const defined: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) defined[key] = value;
  }
  return defined;
}

function buildElectronLaunchEnvironment(): Record<string, string> {
  return {
    ...keepDefinedStringEntries(process.env),
    ELECTRON_RENDERER_URL: resolveRendererDevServerUrl(),
    MSI_E2E: "1",
  };
}

function isMainApplicationWindowUrl(url: string): boolean {
  if (url === "" || url === "about:blank") return false;
  if (url.startsWith("devtools://")) return false;
  return !url.includes("splash");
}

function findMainApplicationWindow(app: ElectronApplication): Page | undefined {
  return app.windows().find((window) => isMainApplicationWindowUrl(window.url()));
}

export function countMainApplicationWindows(app: ElectronApplication): number {
  return app.windows().filter((window) => isMainApplicationWindowUrl(window.url()))
    .length;
}

function waitForMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolveTimer) => setTimeout(resolveTimer, milliseconds));
}

async function waitForMainApplicationWindow(
  app: ElectronApplication,
): Promise<Page> {
  for (let attempt = 0; attempt < MAX_WINDOW_POLL_ATTEMPTS; attempt += 1) {
    const window = findMainApplicationWindow(app);
    if (window !== undefined) return window;
    await waitForMilliseconds(WINDOW_POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for the MSI Toolbox main window");
}

export async function launchToolboxApp(): Promise<LaunchedApp> {
  const app = await electron.launch({
    args: [APPLICATION_ROOT_PATH],
    env: buildElectronLaunchEnvironment(),
  });
  const window = await waitForMainApplicationWindow(app);
  await window.waitForLoadState("domcontentloaded");
  return { app, window };
}

export async function closeToolboxApp(launched: LaunchedApp): Promise<void> {
  await launched.app.close();
}
