// CT-219 scratch diagnostic (NEVER COMMITTED): where does the 1.54 GB TIFF
// load stall? Captures main-process stdout/stderr and renderer console while
// the load runs, then dumps everything after a fixed observation window.
import { test } from "@playwright/test";

import { launchToolboxApp } from "./support/launch-app";
import { enqueueOpenDialogPaths } from "./support/dialog-stub-controls";
import { applicationToolbar } from "./support/operations";
import { REFERENCE_STACK_PATH } from "./scale-audit.support";

test("DIAG reference TIFF load with console capture", async () => {
  test.setTimeout(10 * 60_000);
  const launched = await launchToolboxApp();
  const mainLines: string[] = [];
  const rendererLines: string[] = [];
  launched.app.process().stdout?.on("data", (d) => mainLines.push(`[main out] ${d}`));
  launched.app.process().stderr?.on("data", (d) => mainLines.push(`[main err] ${d}`));
  launched.window.on("console", (message) => rendererLines.push(`[renderer ${message.type()}] ${message.text()}`));
  launched.window.on("pageerror", (error) => rendererLines.push(`[renderer pageerror] ${error.message}`));

  await enqueueOpenDialogPaths(launched.window, [REFERENCE_STACK_PATH]);
  await applicationToolbar(launched.window).getByRole("button", { name: "Open image" }).click();

  launched.window.on("crash", () => rendererLines.push("[renderer CRASHED]"));
  launched.window.on("close", () => rendererLines.push("[renderer window closed]"));

  try {
    for (let elapsed = 0; elapsed < 180; elapsed += 10) {
      await new Promise((r) => setTimeout(r, 10_000));
      const overlay = await launched.window.locator('[role="alertdialog"]').count();
      const metrics = await launched.app.evaluate(({ app }) =>
        app.getAppMetrics().map((m) => `${m.type}:${Math.round(m.memory.workingSetSize / 1024)}MB`),
      );
      console.log(`t=${elapsed + 10}s overlay=${overlay} metrics=${metrics.join(" ")}`);
    }
  } catch (error) {
    console.log(`OBSERVATION LOOP ENDED: ${String(error).slice(0, 200)}`);
  } finally {
    console.log("=== MAIN PROCESS OUTPUT ===");
    for (const line of mainLines.slice(-60)) console.log(line.trim());
    console.log("=== RENDERER CONSOLE ===");
    for (const line of rendererLines.slice(-60)) console.log(line.trim());
    await launched.app.close().catch(() => undefined);
  }
});
