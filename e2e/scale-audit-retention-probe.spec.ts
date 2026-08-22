// CT-239 SCRATCH (NEVER COMMITTED): does a closed result panel's cube actually
// leave the pool? Opens 45 bands, applies Percentile Clip band-wise (9 GB
// float result), closes the result with forced GC, and measures the free pool
// at each stage.
import { test } from "@playwright/test";

import { selectBandWiseScopeForBands } from "./support/cube-scope-control";
import { openOperation } from "./support/operations";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { selectPanel } from "./support/panels";
import {
  applyOperationWithBudget,
  closeGridPanel,
  forceRendererGarbageCollection,
  openScale10GroupedBandFiles,
  SCALE10_APPLY_BUDGET_MS,
  SCALE10_GROUPED_OPEN_BUDGET_MS,
  skipUnlessScale10SweepIsEnabled,
} from "./scale10.support";

let launched: LaunchedApp;

test.beforeEach(async () => {
  skipUnlessScale10SweepIsEnabled();
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  try {
    await closeToolboxApp(launched);
  } catch {
    await launched.app.close().catch(() => undefined);
  }
});

async function measureFreePoolMb(label: string): Promise<number> {
  const freeMb = await launched.window.evaluate(async () => {
    const held: Uint16Array[] = [];
    try {
      for (let i = 0; i < 200; i += 1) {
        const chunk = new Uint16Array(50_000_000);
        chunk[0] = 1;
        held.push(chunk);
        if (i % 10 === 9) await new Promise((r) => setTimeout(r, 1));
      }
    } catch {
      // pool exhausted
    }
    const allocated = held.length * 100;
    held.length = 0;
    const collect = (window as unknown as { gc?: () => void }).gc;
    if (collect) {
      collect();
      collect();
    }
    return allocated;
  });
  console.log(`RETENTIONPROBE ${label}: free ${freeMb} MB`);
  return freeMb;
}

test("pool across apply, close, and gc", async () => {
  test.setTimeout(30 * 60_000);
  await openScale10GroupedBandFiles(launched.window, SCALE10_GROUPED_OPEN_BUDGET_MS, 45);
  await selectPanel(launched.window, 1);
  await forceRendererGarbageCollection(launched.window);
  await measureFreePoolMb("after open + gc");
  await openOperation(launched.window, "Percentile Clip");
  await selectBandWiseScopeForBands(launched.window, "Percentile Clip", "1");
  await applyOperationWithBudget(launched.window, "Percentile Clip", SCALE10_APPLY_BUDGET_MS);
  await measureFreePoolMb("after band-wise apply (result open)");
  await closeGridPanel(launched.window, 2);
  await forceRendererGarbageCollection(launched.window);
  await measureFreePoolMb("after close + gc");
  // React's fiber double-buffering keeps the PREVIOUS render's state alive
  // until another update lands; churn a couple of renders like the real flows
  // do (panel selection, opening a panel), then measure again.
  await selectPanel(launched.window, 1);
  await openOperation(launched.window, "Percentile Clip");
  await launched.window.waitForTimeout(2_000);
  await forceRendererGarbageCollection(launched.window);
  await measureFreePoolMb("after close + render churn + gc");
});
