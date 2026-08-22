import type { Page } from "@playwright/test";

// CT-290: reads the MSI_E2E-gated raster-buffer-release counters installed by
// src/renderer/src/lib/instrumentation/raster-release-instrumentation.ts. In a
// production build the object never exists, so reads fall back to zeros.

export interface RasterReleaseInstrumentationCounters {
  detachedBufferCount: number;
  releasedByteCount: number;
  skippedSharedBufferCount: number;
}

declare global {
  interface Window {
    __msiRasterReleaseInstrumentation?: RasterReleaseInstrumentationCounters;
  }
}

export function readRasterReleaseCounters(
  page: Page,
): Promise<RasterReleaseInstrumentationCounters> {
  return page.evaluate(
    () =>
      window.__msiRasterReleaseInstrumentation ?? {
        detachedBufferCount: 0,
        releasedByteCount: 0,
        skippedSharedBufferCount: 0,
      },
  );
}
