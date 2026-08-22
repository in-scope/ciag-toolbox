import {
  app,
  Menu,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";
import { SCRIPTING_DOCS_URL } from "../shared/scripting-docs-url";
import {
  applyThemeModeFromMenu,
  getCurrentThemeMode,
} from "./theme-controller";
import type { ThemeMode } from "./theme-state";
import {
  listMenuCommandsAlphabetically,
  OPERATION_MENUS,
  type OperationCommand,
  type OperationMenu,
} from "../shared/operation-menu-catalog";
import { SELECTABLE_GRID_LAYOUTS, type GridLayout } from "../shared/grid-layouts";

const isRunningOnMac = process.platform === "darwin";
const isRunningInDevMode = process.env.NODE_ENV === "development";
const MENU_INVOKE_COMMAND_CHANNEL = "menu:invoke-command";
const MENU_SELECT_GRID_LAYOUT_CHANNEL = "menu:select-grid-layout";

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

function buildOpenImagesMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: "Open Images...",
    accelerator: "CmdOrCtrl+O",
    click: () => sendMenuChannelToRenderer(window, "menu:open-image"),
  };
}

function buildSaveImageMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: "Save Image...",
    accelerator: "CmdOrCtrl+S",
    click: () => sendMenuChannelToRenderer(window, "menu:save-image"),
  };
}

function buildOpenProjectMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: "Open Project...",
    accelerator: "CmdOrCtrl+Shift+O",
    click: () => sendMenuChannelToRenderer(window, "menu:open-project"),
  };
}

function buildSaveProjectMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: "Save Project",
    accelerator: "CmdOrCtrl+Shift+S",
    click: () => sendMenuChannelToRenderer(window, "menu:save-project"),
  };
}

function buildSaveProjectAsMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: "Save Project As...",
    click: () => sendMenuChannelToRenderer(window, "menu:save-project-as"),
  };
}

function sendGridLayoutSelectionToRenderer(
  window: BrowserWindow,
  layout: GridLayout,
): void {
  if (window.isDestroyed()) return;
  window.webContents.send(MENU_SELECT_GRID_LAYOUT_CHANNEL, layout);
}

// CT-289: the File menu mirrors the toolbar's grid layouts, after the project
// items.
function buildGridLayoutsSubmenu(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    label: "Grid",
    submenu: SELECTABLE_GRID_LAYOUTS.map((layout) => ({
      label: layout,
      click: () => sendGridLayoutSelectionToRenderer(window, layout),
    })),
  };
}

function buildFileMenu(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    label: "File",
    submenu: [
      buildOpenImagesMenuItem(window),
      buildSaveImageMenuItem(window),
      { type: "separator" },
      buildOpenProjectMenuItem(window),
      buildSaveProjectMenuItem(window),
      buildSaveProjectAsMenuItem(window),
      { type: "separator" },
      buildGridLayoutsSubmenu(window),
      { type: "separator" },
      isRunningOnMac ? { role: "close" } : { role: "quit" },
    ],
  };
}

function sendMenuCommandToRenderer(
  window: BrowserWindow,
  commandId: string,
): void {
  if (window.isDestroyed()) return;
  window.webContents.send(MENU_INVOKE_COMMAND_CHANNEL, commandId);
}

function buildOperationCommandMenuItem(
  window: BrowserWindow,
  command: OperationCommand,
): MenuItemConstructorOptions {
  return {
    label: command.label,
    click: () => sendMenuCommandToRenderer(window, command.id),
  };
}

// Operation menus are flat alphabetical lists with no separators: find an
// operation by name. (File keeps its separators; its groups are workflows,
// not an operation inventory.)
function buildOperationMenu(
  window: BrowserWindow,
  menu: OperationMenu,
): MenuItemConstructorOptions {
  const items = listMenuCommandsAlphabetically(menu).map((command) =>
    buildOperationCommandMenuItem(window, command),
  );
  return { label: menu.menuLabel, submenu: items };
}

function buildOperationMenus(window: BrowserWindow): MenuItemConstructorOptions[] {
  return OPERATION_MENUS.map((menu) => buildOperationMenu(window, menu));
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

function buildDeveloperRefreshMenuItems(): MenuItemConstructorOptions[] {
  if (!isRunningInDevMode) return [];
  return [
    { type: "separator" },
    { role: "reload" },
    { role: "toggleDevTools" },
  ];
}

function buildPythonEnvironmentMenuItem(
  window: BrowserWindow,
): MenuItemConstructorOptions {
  return {
    label: "Python Environment...",
    click: () => sendMenuChannelToRenderer(window, "menu:python-environment"),
  };
}

function buildViewMenuSubmenu(
  window: BrowserWindow,
): MenuItemConstructorOptions[] {
  return [
    buildThemeSubmenu(),
    { type: "separator" },
    buildPythonEnvironmentMenuItem(window),
    ...buildDeveloperRefreshMenuItems(),
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
}

function buildViewMenu(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    label: "View",
    submenu: buildViewMenuSubmenu(window),
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

function buildHowToWriteScriptMenuItem(): MenuItemConstructorOptions {
  return {
    label: "How to Write a Custom Script",
    click: () => void shell.openExternal(SCRIPTING_DOCS_URL),
  };
}

function buildHelpMenu(window: BrowserWindow): MenuItemConstructorOptions {
  return {
    role: "help",
    submenu: [
      buildHowToWriteScriptMenuItem(),
      { type: "separator" },
      buildAboutMenuItem(window),
    ],
  };
}

function buildMenuTemplateForPlatform(
  window: BrowserWindow,
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  if (isRunningOnMac) template.push(buildMacAppMenu());
  template.push(buildFileMenu(window));
  template.push(...buildOperationMenus(window));
  template.push(buildViewMenu(window));
  template.push(buildHelpMenu(window));
  return template;
}

export function installApplicationMenu(window: BrowserWindow): void {
  const template = buildMenuTemplateForPlatform(window);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
