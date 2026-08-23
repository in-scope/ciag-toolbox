import { describe, expect, it } from "vitest";
import { chooseAppUserModelIdForTaskbarGrouping } from "./app-user-model-id";

describe("chooseAppUserModelIdForTaskbarGrouping", () => {
  it("matches the electron-builder appId for packaged builds", () => {
    expect(chooseAppUserModelIdForTaskbarGrouping(false)).toBe(
      "sh.inscope.ciag.toolbox",
    );
  });

  it("uses a distinct id in development so the taskbar never resolves the installed shortcut's icon", () => {
    expect(chooseAppUserModelIdForTaskbarGrouping(true)).toBe(
      "sh.inscope.ciag.toolbox.dev",
    );
  });
});
