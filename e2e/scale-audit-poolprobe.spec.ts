// CT-239 SCRATCH (NEVER COMMITTED): measures how much of the renderer's
// ArrayBuffer pool is actually free after the 45-band grouped open, by
// allocating 100 MB chunks until failure and releasing them again.
import { test } from "@playwright/test";

import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { selectPanel } from "./support/panels";
import {
  forceRendererGarbageCollection,
  openScale10GroupedBandFiles,
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
  console.log(`POOLPROBE ${label}: free ${freeMb} MB`);
  return freeMb;
}

async function measureFloatBandCapacity(label: string): Promise<number> {
  const bands = await launched.window.evaluate(async () => {
    const held: Float32Array[] = [];
    try {
      for (let i = 0; i < 100; i += 1) {
        const band = new Float32Array(50_000_000);
        band[0] = 1;
        held.push(band);
        await new Promise((r) => setTimeout(r, 1));
      }
    } catch {
      // pool exhausted
    }
    const count = held.length;
    held.length = 0;
    const collect = (window as unknown as { gc?: () => void }).gc;
    if (collect) {
      collect();
      collect();
    }
    return count;
  });
  console.log(`POOLPROBE ${label}: ${bands} float bands (${bands * 200} MB)`);
  return bands;
}

test("free pool before and after the 45-band grouped open", async () => {
  test.setTimeout(20 * 60_000);
  await measureFreePoolMb("fresh app 100MB chunks");
  await forceRendererGarbageCollection(launched.window);
  await openScale10GroupedBandFiles(launched.window, SCALE10_GROUPED_OPEN_BUDGET_MS, 45);
  await selectPanel(launched.window, 1);
  await forceRendererGarbageCollection(launched.window);
  await measureFreePoolMb("after open + gc, 100MB chunks");
  await forceRendererGarbageCollection(launched.window);
  await measureFloatBandCapacity("after open + gc, 200MB float bands");
});
