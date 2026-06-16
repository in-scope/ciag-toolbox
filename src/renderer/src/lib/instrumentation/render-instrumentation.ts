// CT-171: dev-only render instrumentation, gated exactly like the MSI_E2E
// dialog surface. The preload exposes window.toolboxE2E ONLY under the
// --msi-e2e-test-mode argument, so its presence is the signal that this is a
// test build. In a production build the bridge is absent, the counters object
// is never installed, and every record call below is a no-op: no test surface
// ships. e2e reads window.__msiRenderInstrumentation to assert that editing a
// tone curve neither re-uploads the image texture nor allocates a preview raster.

export interface RenderInstrumentationCounters {
  imageTextureUploads: number;
  previewRasterAllocations: number;
}

declare global {
  interface Window {
    __msiRenderInstrumentation?: RenderInstrumentationCounters;
  }
}

export function recordImageTextureUpload(): void {
  const counters = readInstalledCountersOrNull();
  if (counters) counters.imageTextureUploads += 1;
}

export function recordPreviewRasterAllocation(): void {
  const counters = readInstalledCountersOrNull();
  if (counters) counters.previewRasterAllocations += 1;
}

function readInstalledCountersOrNull(): RenderInstrumentationCounters | null {
  if (!isE2eTestModeActiveInRenderer()) return null;
  return installRenderInstrumentationCountersOnce();
}

function isE2eTestModeActiveInRenderer(): boolean {
  return typeof window !== "undefined" && "toolboxE2E" in window;
}

function installRenderInstrumentationCountersOnce(): RenderInstrumentationCounters {
  const existing = window.__msiRenderInstrumentation;
  if (existing) return existing;
  const counters: RenderInstrumentationCounters = {
    imageTextureUploads: 0,
    previewRasterAllocations: 0,
  };
  window.__msiRenderInstrumentation = counters;
  return counters;
}
