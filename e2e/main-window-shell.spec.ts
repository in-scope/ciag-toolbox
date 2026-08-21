import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  closeToolboxApp,
  countMainApplicationWindows,
  launchToolboxApp,
  type LaunchedApp,
} from "./support/launch-app";
import {
  listMenuCommandsAlphabetically,
  OPERATION_MENUS,
} from "../src/shared/operation-menu-catalog";
import { SELECTABLE_GRID_LAYOUTS } from "../src/shared/grid-layouts";
import {
  describeApplicationMenu,
  readAppNameAndVersion,
  readMainWindowOuterBounds,
  readUserDataDirectory,
  resizeAndMoveMainWindow,
  triggerAboutMenuItem,
  triggerFileGridLayoutMenuItem,
  type MenuItemSummary,
  type WindowOuterBounds,
} from "./support/main-process";
import { gridLayoutDropdownTrigger } from "./support/grid-layout-controls";

// Manual test script section 3 (CT-003): main window shell, menus, About dialog.

const requireFromHere = createRequire(import.meta.url);
const packageJson = requireFromHere("../package.json") as { version: string };

interface WindowStateBackup {
  path: string;
  existed: boolean;
  content: string;
}

let launched: LaunchedApp;
let windowStateBackup: WindowStateBackup;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
  const userDataDirectory = await readUserDataDirectory(launched.app);
  windowStateBackup = captureWindowStateBackup(
    join(userDataDirectory, "window-state.json"),
  );
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
  restoreWindowStateBackup(windowStateBackup);
});

test("opens exactly one main application window", () => {
  expect(countMainApplicationWindows(launched.app)).toBe(1);
});

test("main window opens at a sensible size", async () => {
  const bounds = await readMainWindowOuterBounds(launched.app);
  expect(bounds.width).toBeGreaterThanOrEqual(1024);
  expect(bounds.height).toBeGreaterThanOrEqual(700);
});

test("File menu exposes Open Images and the app can be quit", async () => {
  const menu = await describeApplicationMenu(launched.app);
  const fileMenu = findTopLevelMenu(menu, "File");
  expect(submenuLabelsOf(fileMenu)).toContain("Open Images...");
  expect(menuTreeHasQuitItem(menu)).toBe(true);
});

// CT-289: the File menu gains a Grid submenu mirroring the toolbar's layouts,
// placed after the project items.
test("File menu carries a Grid submenu of the selectable layouts after the project items", async () => {
  const menu = await describeApplicationMenu(launched.app);
  const fileMenu = findTopLevelMenu(menu, "File");
  const labels = submenuLabelsOf(fileMenu);
  expect(labels).toContain("Grid");
  expect(labels.indexOf("Grid")).toBeGreaterThan(labels.indexOf("Save Project As..."));
  const gridSubmenu = fileMenu?.submenu.find((item) => item.label === "Grid");
  expect(submenuLabelsOf(gridSubmenu)).toEqual([...SELECTABLE_GRID_LAYOUTS]);
});

test("File > Grid selects a layout exactly like the toolbar dropdown", async () => {
  await triggerFileGridLayoutMenuItem(launched.app, "1x2");
  await expect(gridLayoutDropdownTrigger(launched.window)).toHaveAccessibleName(
    "Grid layout (currently 1x2)",
  );
  await triggerFileGridLayoutMenuItem(launched.app, "1x1");
  await expect(gridLayoutDropdownTrigger(launched.window)).toHaveAccessibleName(
    "Grid layout (currently 1x1)",
  );
});

test("every operation menu mirrors the shared catalog, alphabetically and without separators", async () => {
  const menu = await describeApplicationMenu(launched.app);
  for (const operationMenu of OPERATION_MENUS) {
    const topLevel = findTopLevelMenu(menu, operationMenu.menuLabel);
    expect(topLevel, `missing top-level menu "${operationMenu.menuLabel}"`).toBeDefined();
    expect(submenuLabelsOf(topLevel)).toEqual(nonSeparatorLabelsOf(topLevel));
    expect(nonSeparatorLabelsOf(topLevel)).toEqual(menuItemLabelsFromCatalog(operationMenu));
  }
});

test("View menu is present", async () => {
  const menu = await describeApplicationMenu(launched.app);
  expect(findTopLevelMenu(menu, "View")).toBeDefined();
});

test("Help menu exposes About", async () => {
  const menu = await describeApplicationMenu(launched.app);
  const helpMenu = findHelpMenu(menu);
  expect(submenuLabelsOf(helpMenu).some(isAboutLabel)).toBe(true);
});

test("Help > About opens a shadcn dialog showing the app name and version", async () => {
  await triggerAboutMenuItem(launched.app);
  const dialog = launched.window.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const appInfo = await readAppNameAndVersion(launched.app);
  expect(appInfo.version).toBe(packageJson.version);
  await expect(dialog.getByText(`About ${appInfo.name}`)).toBeVisible();
  await expect(dialog.getByText(`Version ${appInfo.version}`)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  await closeAboutDialog(dialog);
});

test("window size persists across close and reopen", async () => {
  await assertWindowSizeRoundTripsAcrossRelaunch({
    width: 1100,
    height: 720,
    x: 120,
    y: 90,
  });
});

async function closeAboutDialog(
  dialog: ReturnType<LaunchedApp["window"]["getByRole"]>,
): Promise<void> {
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
}

async function assertWindowSizeRoundTripsAcrossRelaunch(
  target: WindowOuterBounds,
): Promise<void> {
  const first = await launchToolboxApp();
  await resizeAndMoveMainWindow(first.app, target);
  await closeToolboxApp(first);
  const second = await launchToolboxApp();
  const restored = await readMainWindowOuterBounds(second.app);
  await closeToolboxApp(second);
  expect(restored.width).toBe(target.width);
  expect(restored.height).toBe(target.height);
}

function findTopLevelMenu(
  menu: MenuItemSummary[],
  label: string,
): MenuItemSummary | undefined {
  return menu.find((item) => item.label === label);
}

function findHelpMenu(menu: MenuItemSummary[]): MenuItemSummary | undefined {
  return menu.find((item) => item.role === "help" || item.label === "Help");
}

function submenuLabelsOf(menu: MenuItemSummary | undefined): string[] {
  return (menu?.submenu ?? []).map((item) => item.label);
}

function nonSeparatorLabelsOf(menu: MenuItemSummary | undefined): string[] {
  return submenuLabelsOf(menu).filter((label) => typeof label === "string" && label.length > 0);
}

function menuItemLabelsFromCatalog(
  operationMenu: (typeof OPERATION_MENUS)[number],
): string[] {
  return listMenuCommandsAlphabetically(operationMenu).map((command) => command.label);
}

function isAboutLabel(label: string): boolean {
  return label.startsWith("About");
}

function menuTreeHasQuitItem(menu: MenuItemSummary[]): boolean {
  return menu.some(menuNodeContainsQuit);
}

function menuNodeContainsQuit(item: MenuItemSummary): boolean {
  if (item.role === "quit") return true;
  return item.submenu.some(menuNodeContainsQuit);
}

function captureWindowStateBackup(path: string): WindowStateBackup {
  const existed = existsSync(path);
  return { path, existed, content: existed ? readFileSync(path, "utf-8") : "" };
}

function restoreWindowStateBackup(backup: WindowStateBackup): void {
  if (backup.existed) {
    writeFileSync(backup.path, backup.content);
    return;
  }
  if (existsSync(backup.path)) rmSync(backup.path);
}
