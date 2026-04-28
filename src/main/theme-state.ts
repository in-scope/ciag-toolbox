import { app } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ThemeMode = "system" | "light" | "dark";

const THEME_STATE_FILE_NAME = "theme-state.json";
const DEFAULT_THEME_MODE: ThemeMode = "system";

function getThemeStateFilePath(): string {
  return join(app.getPath("userData"), THEME_STATE_FILE_NAME);
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function parseThemeModeJson(json: string): ThemeMode {
  const data = JSON.parse(json) as { mode?: unknown };
  return isThemeMode(data.mode) ? data.mode : DEFAULT_THEME_MODE;
}

export function loadSavedThemeMode(): ThemeMode {
  const path = getThemeStateFilePath();
  if (!existsSync(path)) return DEFAULT_THEME_MODE;
  try {
    return parseThemeModeJson(readFileSync(path, "utf-8"));
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

export function persistThemeModeToDisk(mode: ThemeMode): void {
  try {
    writeFileSync(getThemeStateFilePath(), JSON.stringify({ mode }));
  } catch {
    // best-effort persistence; do not block UI on a failed write
  }
}
