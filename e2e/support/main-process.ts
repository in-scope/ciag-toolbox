import type { ElectronApplication } from "@playwright/test";

export interface MenuItemSummary {
  label: string;
  role: string | undefined;
  submenu: MenuItemSummary[];
}

export interface WindowOuterBounds {
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface AppNameAndVersion {
  name: string;
  version: string;
}

export function describeApplicationMenu(
  app: ElectronApplication,
): Promise<MenuItemSummary[]> {
  return app.evaluate(({ Menu }) => {
    interface RawMenuNode {
      label: string;
      role?: string;
      submenu?: { items: RawMenuNode[] };
    }
    const summarize = (item: RawMenuNode): MenuItemSummary => ({
      label: item.label,
      role: item.role,
      submenu: (item.submenu?.items ?? []).map(summarize),
    });
    const menu = Menu.getApplicationMenu() as unknown as {
      items: RawMenuNode[];
    } | null;
    return (menu?.items ?? []).map(summarize);
  });
}

export function triggerAboutMenuItem(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ Menu }) => {
    interface RawMenuNode {
      label: string;
      role?: string;
      click?: () => void;
      submenu?: { items: RawMenuNode[] };
    }
    const menu = Menu.getApplicationMenu() as unknown as {
      items: RawMenuNode[];
    } | null;
    const help = (menu?.items ?? []).find(
      (item) => item.role === "help" || item.label === "Help",
    );
    const about = help?.submenu?.items.find((item) =>
      item.label.startsWith("About"),
    );
    about?.click?.();
  });
}

export function readAppNameAndVersion(
  app: ElectronApplication,
): Promise<AppNameAndVersion> {
  return app.evaluate(({ app: electronApp }) => ({
    name: electronApp.getName(),
    version: electronApp.getVersion(),
  }));
}

export function readMainWindowOuterBounds(
  app: ElectronApplication,
): Promise<WindowOuterBounds> {
  return app.evaluate(({ BrowserWindow }) => {
    const isMainUrl = (url: string): boolean =>
      url !== "" &&
      url !== "about:blank" &&
      !url.startsWith("devtools://") &&
      !url.includes("splash");
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      isMainUrl(candidate.webContents.getURL()),
    );
    if (!window) throw new Error("No main window found in the main process");
    const bounds = window.getBounds();
    return { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
  });
}

export function resizeAndMoveMainWindow(
  app: ElectronApplication,
  target: WindowOuterBounds,
): Promise<void> {
  return app.evaluate(
    ({ BrowserWindow }, requestedBounds) => {
      const isMainUrl = (url: string): boolean =>
        url !== "" &&
        url !== "about:blank" &&
        !url.startsWith("devtools://") &&
        !url.includes("splash");
      const window = BrowserWindow.getAllWindows().find((candidate) =>
        isMainUrl(candidate.webContents.getURL()),
      );
      if (!window) throw new Error("No main window found in the main process");
      window.unmaximize();
      window.setBounds(requestedBounds);
    },
    target,
  );
}

export function readUserDataDirectory(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"));
}
