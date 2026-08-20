import { _electron as electron, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { runAsStoryboardStep, tracingIsEnabled } from "./storyboard-step";
import { composeTraceRunFolderLabel, composeTraceZipFileName } from "./trace-run-label";

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

// Page-object helpers that only receive the window (e.g. openOperation) still
// need the owning ElectronApplication to drive the native menu; launchToolboxApp
// registers every window here so they can look it up.
const electronApplicationByWindow = new WeakMap<Page, ElectronApplication>();

export function electronApplicationForWindow(window: Page): ElectronApplication {
  const app = electronApplicationByWindow.get(window);
  if (app) return app;
  throw new Error(
    "No Electron application registered for this window; launch it via launchToolboxApp",
  );
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

function buildElectronLaunchEnvironment(
  options: LaunchToolboxAppOptions,
): Record<string, string> {
  const environment: Record<string, string> = {
    ...keepDefinedStringEntries(process.env),
    ELECTRON_RENDERER_URL: resolveRendererDevServerUrl(),
    MSI_E2E: "1",
    ...(options.extraEnvironment ?? {}),
  };
  // A packaged build must load its own built renderer: main treats a set
  // ELECTRON_RENDERER_URL as "running in development" and would load the
  // (absent) dev server into a blank window and open detached DevTools.
  if (options.packagedExecutablePath !== undefined) {
    delete environment["ELECTRON_RENDERER_URL"];
  }
  return environment;
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

// Traces from successive runs land in distinct per-process run folders so
// nothing is ever overwritten (the opt-out rule lives in storyboard-step.ts).
const TRACE_RUN_FOLDER_LABEL = composeTraceRunFolderLabel(
  process.env["MSI_E2E_TRACE_LABEL"],
  new Date(),
);

async function startTracingIfEnabled(app: ElectronApplication): Promise<void> {
  if (!tracingIsEnabled()) return;
  await app
    .context()
    .tracing.start({ screenshots: true, snapshots: true, sources: true });
}

const appsWithStoppedTracing = new WeakSet<ElectronApplication>();

async function stopTracingIfEnabled(app: ElectronApplication): Promise<void> {
  if (!tracingIsEnabled()) return;
  if (appsWithStoppedTracing.has(app)) return;
  appsWithStoppedTracing.add(app);
  const tracePath = nextTraceOutputPath();
  await app.context().tracing.stop({ path: tracePath });
  await attachTraceZipToCurrentTest(tracePath);
}

// For specs whose final action makes the app itself exit (the CT-258 close
// guard tests): save the trace while the context is still alive, then let the
// exit happen. closeToolboxApp stays safe to skip afterwards.
export async function saveTraceBeforeExpectedAppExit(launched: LaunchedApp): Promise<void> {
  await runAsStoryboardStep(null, "Save the trace before the app exits", async () => {
    await stopTracingIfEnabled(launched.app);
  });
}

let savedTraceCount = 0;

function nextTraceOutputPath(): string {
  savedTraceCount += 1;
  const fileName = composeTraceZipFileName(currentTestTitleLabel(), savedTraceCount);
  return resolve(
    APPLICATION_ROOT_PATH,
    "test-results",
    "electron-traces",
    TRACE_RUN_FOLDER_LABEL,
    fileName,
  );
}

function currentTestTitleLabel(): string {
  try {
    return test.info().titlePath.join("-");
  } catch {
    return "";
  }
}

// The attachment gives the HTML report a per-test trace-viewer link.
async function attachTraceZipToCurrentTest(tracePath: string): Promise<void> {
  try {
    await test
      .info()
      .attach("trace", { path: tracePath, contentType: "application/zip" });
  } catch {
    // Trace saved outside a running test; there is no report entry to attach to.
  }
}

export interface LaunchToolboxAppOptions {
  // Extra launch environment entries, e.g. the CT-260 lowered-memory-budget
  // variable (MSI_E2E_MEMORY_BUDGET_BYTES) that makes refusals reproducible
  // with tiny fixtures.
  readonly extraEnvironment?: Record<string, string>;
  // Launch an installed/packed build instead of the dev checkout (the CT-262
  // packaged smoke). A packaged main ignores ELECTRON_RENDERER_URL and loads
  // its own built renderer, so no dev server is needed; the MSI_E2E test
  // surface still activates because it is gated on the environment at runtime.
  readonly packagedExecutablePath?: string;
}

function electronLaunchTarget(
  options: LaunchToolboxAppOptions,
): { args: string[]; executablePath?: string } {
  if (options.packagedExecutablePath === undefined) return { args: [APPLICATION_ROOT_PATH] };
  return { args: [], executablePath: options.packagedExecutablePath };
}

export async function launchToolboxApp(
  options: LaunchToolboxAppOptions = {},
): Promise<LaunchedApp> {
  return runAsStoryboardStep(null, "Launch the app and wait for the main window", async () => {
    const app = await electron.launch({
      ...electronLaunchTarget(options),
      env: buildElectronLaunchEnvironment(options),
    });
    await startTracingIfEnabled(app);
    const window = await waitForMainApplicationWindow(app);
    await window.waitForLoadState("domcontentloaded");
    electronApplicationByWindow.set(window, app);
    return { app, window };
  });
}

export async function closeToolboxApp(launched: LaunchedApp): Promise<void> {
  await runAsStoryboardStep(null, "Close the app and save its trace", async () => {
    await stopTracingIfEnabled(launched.app);
    await confirmWindowCloseBypassingTheSaveGuard(launched);
    await launched.app.close().catch(() => undefined);
  });
}

// CT-258: the app asks before closing when unsaved work exists, and most specs
// end with unsaved panels on purpose. Teardown must close unconditionally, so
// it confirms the close through the same IPC the renderer's guard uses; the
// confirmed close still runs the window's close listeners (window-state
// persistence), unlike a destroy(). A crashed or already-closed page is fine:
// main lets those windows close without asking.
declare global {
  interface Window {
    toolboxApi: { confirmWindowClose: () => Promise<void> };
  }
}

async function confirmWindowCloseBypassingTheSaveGuard(launched: LaunchedApp): Promise<void> {
  await launched.window
    .evaluate(() => window.toolboxApi.confirmWindowClose())
    .catch(() => undefined);
}
