import {
  app,
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";
import {
  applyThemeModeFromMenu,
  getCurrentThemeMode,
} from "./theme-controller";
import type { ThemeMode } from "./theme-state";

const isRunningOnMac = process.platform === "darwin";

function buildMacAppMenu(): MenuItemConstructorOptions {
  return {
    label: app.getName(),
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };
}

function sendMenuChannelToRenderer(
  window: BrowserWindow,
  channel: string,
): void {
  if (window.isDestroyed()) return;
  window.webContents.send(channel);
}

function buildOpenImageMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: "Open Image...",
    accelerator: "CmdOrCtrl+O",
    click: () => sendMenuChannelToRenderer(window, "menu:open-image"),
  };
}

function buildFileMenu(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    label: "File",
    submenu: [
      buildOpenImageMenuItem(window),
      { type: "separator" },
      isRunningOnMac ? { role: "close" } : { role: "quit" },
    ],
  };
}

function buildThemeRadioItem(
  label: string,
  mode: ThemeMode,
  currentMode: ThemeMode,
): MenuItemConstructorOptions {
  return {
    label,
    type: "radio",
    checked: currentMode === mode,
    click: () => applyThemeModeFromMenu(mode),
  };
}

function buildThemeSubmenu(): MenuItemConstructorOptions {
  const currentMode = getCurrentThemeMode();
  return {
    label: "Theme",
    submenu: [
      buildThemeRadioItem("System", "system", currentMode),
      buildThemeRadioItem("Light", "light", currentMode),
      buildThemeRadioItem("Dark", "dark", currentMode),
    ],
  };
}

function buildViewMenu(): MenuItemConstructorOptions {
  return {
    label: "View",
    submenu: [
      buildThemeSubmenu(),
      { type: "separator" },
      { role: "reload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };
}

function buildAboutMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: `About ${app.getName()}`,
    click: () => sendMenuChannelToRenderer(window, "menu:about"),
  };
}

function buildHelpMenu(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    role: "help",
    submenu: [buildAboutMenuItem(window)],
  };
}

function buildMenuTemplateForPlatform(
  window: BrowserWindow,
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  if (isRunningOnMac) template.push(buildMacAppMenu());
  template.push(buildFileMenu(window));
  template.push(buildViewMenu());
  template.push(buildHelpMenu(window));
  return template;
}

export function installApplicationMenu(window: BrowserWindow): void {
  const template = buildMenuTemplateForPlatform(window);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
