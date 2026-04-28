import { BrowserWindow, ipcMain, nativeTheme } from "electron";
import {
  loadSavedThemeMode,
  persistThemeModeToDisk,
  type ThemeMode,
} from "./theme-state";

export interface ThemeSnapshot {
  mode: ThemeMode;
  isDark: boolean;
}

const THEME_GET_INITIAL_SYNC_CHANNEL = "theme:get-initial-sync";
const THEME_CHANGED_CHANNEL = "theme:changed";

let currentMode: ThemeMode = "system";

function computeIsDarkActiveForMode(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return nativeTheme.shouldUseDarkColors;
}

export function readCurrentThemeSnapshot(): ThemeSnapshot {
  return { mode: currentMode, isDark: computeIsDarkActiveForMode(currentMode) };
}

export function getCurrentThemeMode(): ThemeMode {
  return currentMode;
}

function broadcastThemeSnapshotToWindows(): void {
  const snapshot = readCurrentThemeSnapshot();
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(THEME_CHANGED_CHANNEL, snapshot);
  }
}

export function applyThemeModeFromMenu(mode: ThemeMode): void {
  if (mode === currentMode) return;
  currentMode = mode;
  persistThemeModeToDisk(mode);
  broadcastThemeSnapshotToWindows();
}

function handleNativeThemeUpdated(): void {
  if (currentMode !== "system") return;
  broadcastThemeSnapshotToWindows();
}

function registerInitialThemeSyncIpcHandler(): void {
  ipcMain.on(THEME_GET_INITIAL_SYNC_CHANNEL, (event) => {
    event.returnValue = readCurrentThemeSnapshot();
  });
}

export function initializeThemeControllerFromDisk(): void {
  currentMode = loadSavedThemeMode();
  registerInitialThemeSyncIpcHandler();
  nativeTheme.on("updated", handleNativeThemeUpdated);
}
