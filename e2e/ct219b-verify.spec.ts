// CT-219b at-scale verification (SCRATCH, NEVER COMMITTED - the CT-219
// precedent). Proves the chunked read fix: the 1.15 GB and 1.54 GB single-file
// TIFFs that killed the main process now open through the real UI, show load
// progress, and read exact oracle values; the ENVI header route still works.
import { expect, test } from "@playwright/test";

import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import {
  AUDIT_DIRECTORY,
  openCaptureFromDisk,
  readReportedPixelNear,
  recordAuditResult,
  REFERENCE_DIMENSIONS,
  referenceValue,
} from "./scale-audit.support";
import { join } from "node:path";
import type { Page } from "@playwright/test";

function watchForProgressBar(page: Page): { sawBar: () => boolean; stop: () => void } {
  let sawBar = false;
  let stopped = false;
  const poll = async (): Promise<void> => {
    while (!stopped && !sawBar) {
      sawBar = await page
        .locator('[role="progressbar"]')
        .count()
        .then((count) => count > 0)
        .catch(() => false);
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 200));
    }
  };
  void poll();
  return { sawBar: () => sawBar, stop: () => { stopped = true; } };
}

async function verifySingleFileTiffLoadsWithOracle(fileName: string): Promise<void> {
  const launched = await launchToolboxApp();
  const { window: page } = launched;
  try {
    const progressWatch = watchForProgressBar(page);
    const loadMs = await openCaptureFromDisk(page, join(AUDIT_DIRECTORY, fileName), 300_000);
    progressWatch.stop();
    const reported = await readReportedPixelNear(page, 1, { x: 150, y: 250 }, REFERENCE_DIMENSIONS);
    const expected = referenceValue(0, reported.x, reported.y);
    expect(reported.value).toBe(expected);
    recordAuditResult({
      area: `CT-219b verify: single-file ${fileName}`,
      verdict: "pass",
      loadMs,
      sawProgressBar: progressWatch.sawBar(),
      oracle: { x: reported.x, y: reported.y, value: reported.value, expected },
    });
    expect(progressWatch.sawBar()).toBe(true);
  } finally {
    await closeToolboxApp(launched).catch(() => undefined);
  }
}

test.describe("CT-219b fix verification", () => {
  test("12-band 1.15 GB probe TIFF opens as a single file", async () => {
    test.setTimeout(600_000);
    await verifySingleFileTiffLoadsWithOracle("probe-12band.tif");
  });

  test("16-band 1.54 GB reference TIFF opens as a single file", async () => {
    test.setTimeout(600_000);
    await verifySingleFileTiffLoadsWithOracle("reference-stack.tif");
  });

  test("ENVI header + 1.54 GB sidecar still loads through the chunked route", async () => {
    test.setTimeout(600_000);
    const launched = await launchToolboxApp();
    const { window: page } = launched;
    try {
      const loadMs = await openCaptureFromDisk(
        page,
        join(AUDIT_DIRECTORY, "reference-stack.hdr"),
        300_000,
      );
      const reported = await readReportedPixelNear(page, 1, { x: 150, y: 250 }, REFERENCE_DIMENSIONS);
      const expected = referenceValue(0, reported.x, reported.y);
      expect(reported.value).toBe(expected);
      recordAuditResult({
        area: "CT-219b verify: ENVI .hdr + 1.54 GB sidecar",
        verdict: "pass",
        loadMs,
        oracle: { x: reported.x, y: reported.y, value: reported.value, expected },
      });
    } finally {
      await closeToolboxApp(launched).catch(() => undefined);
    }
  });
});
