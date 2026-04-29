import { app, type BrowserWindow } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

const DEFAULT_BOUNDS: WindowBounds = {
  width: 1280,
  height: 800,
  isMaximized: false,
};

const WINDOW_STATE_FILE_NAME = "window-state.json";

function getWindowStateFilePath(): string {
  return join(app.getPath("userData"), WINDOW_STATE_FILE_NAME);
}

function readNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseWindowBoundsJson(json: string): WindowBounds {
  const data = JSON.parse(json) as Partial<Record<keyof WindowBounds, unknown>>;
  const width = readNumberOrUndefined(data.width);
  const height = readNumberOrUndefined(data.height);
  if (width === undefined || height === undefined) return DEFAULT_BOUNDS;
  return {
    width,
    height,
    x: readNumberOrUndefined(data.x),
    y: readNumberOrUndefined(data.y),
    isMaximized: data.isMaximized === true,
  };
}

export function loadSavedWindowBounds(): WindowBounds {
  const path = getWindowStateFilePath();
  if (!existsSync(path)) return DEFAULT_BOUNDS;
  try {
    return parseWindowBoundsJson(readFileSync(path, "utf-8"));
  } catch {
    return DEFAULT_BOUNDS;
  }
}

function captureCurrentWindowBounds(window: BrowserWindow): WindowBounds {
  const isMaximized = window.isMaximized();
  const bounds = isMaximized ? window.getNormalBounds() : window.getBounds();
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized,
  };
}

function persistWindowBoundsToDisk(bounds: WindowBounds): void {
  try {
    writeFileSync(getWindowStateFilePath(), JSON.stringify(bounds));
  } catch {
    // best-effort persistence; do not block app close on a failed write
  }
}

export function attachWindowStatePersistence(window: BrowserWindow): void {
  window.on("close", () => {
    persistWindowBoundsToDisk(captureCurrentWindowBounds(window));
  });
}
