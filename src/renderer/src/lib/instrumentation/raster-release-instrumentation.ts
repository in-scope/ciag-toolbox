// CT-290: e2e-only observability for the deterministic raster-buffer release,
// gated exactly like the MSI_E2E dialog surface (see render-instrumentation.ts).
// The preload exposes window.toolboxE2E ONLY under --msi-e2e-test-mode, so its
// presence is the signal that this is a test build. In a production build the
// counters object is never installed and every record call is a no-op: no test
// surface ships. e2e reads window.__msiRasterReleaseInstrumentation to assert
// that an in-place apply detached the replaced cube's band buffers instead of
// leaving them to a GC that allocation failure never triggers.

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

export function recordDetachedRasterBuffer(byteLength: number): void {
  const counters = readInstalledCountersOrNull();
  if (!counters) return;
  counters.detachedBufferCount += 1;
  counters.releasedByteCount += byteLength;
}

export function recordSkippedSharedRasterBuffer(): void {
  const counters = readInstalledCountersOrNull();
  if (counters) counters.skippedSharedBufferCount += 1;
}

function readInstalledCountersOrNull(): RasterReleaseInstrumentationCounters | null {
  if (!isE2eTestModeActiveInRenderer()) return null;
  return installRasterReleaseInstrumentationCountersOnce();
}

function isE2eTestModeActiveInRenderer(): boolean {
  return typeof window !== "undefined" && "toolboxE2E" in window;
}

function installRasterReleaseInstrumentationCountersOnce(): RasterReleaseInstrumentationCounters {
  const existing = window.__msiRasterReleaseInstrumentation;
  if (existing) return existing;
  const counters: RasterReleaseInstrumentationCounters = {
    detachedBufferCount: 0,
    releasedByteCount: 0,
    skippedSharedBufferCount: 0,
  };
  window.__msiRasterReleaseInstrumentation = counters;
  return counters;
}
