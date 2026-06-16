import type { Page } from "@playwright/test";

// CT-171: read the dev-only render-instrumentation counters the renderer installs
// on window under the MSI_E2E test surface (lib/instrumentation/render-instrumentation.ts).
// They prove a tone-curve preview neither re-uploads the image texture nor allocates
// a preview raster. The object is absent in production builds, so reads default to 0.

interface RenderInstrumentationCounters {
  imageTextureUploads: number;
  previewRasterAllocations: number;
}

declare global {
  interface Window {
    __msiRenderInstrumentation?: RenderInstrumentationCounters;
  }
}

export function readImageTextureUploadCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__msiRenderInstrumentation?.imageTextureUploads ?? 0);
}

export function readPreviewRasterAllocationCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__msiRenderInstrumentation?.previewRasterAllocations ?? 0);
}
