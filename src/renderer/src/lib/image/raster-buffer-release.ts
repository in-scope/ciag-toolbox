import type { RasterImage } from "@/lib/image/raster-image";
import { listSourceBackingBuffers } from "@/lib/image/raster-memory-budget";
import {
  recordDetachedRasterBuffer,
  recordSkippedSharedRasterBuffer,
} from "@/lib/instrumentation/raster-release-instrumentation";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-290: deterministic release of the band buffers a replaced or closed panel
// leaves behind. V8 runs NO garbage collection when an ArrayBuffer backing-store
// allocation fails (measured, CT-239/CT-240), so a dead multi-gigabyte cube can
// sit uncollected in the ~17 GB renderer pool and fail the very next apply even
// though the budget accounting is correct. The fix is ArrayBuffer.prototype
// .transfer(0), which detaches the buffer and returns its backing store to the
// pool immediately.
//
// Lifecycle:
// - The in-place apply flow and the close-panel flow QUEUE the outgoing raster
//   here; nothing is detached synchronously, so components still rendering the
//   old raster can never observe a detached buffer.
// - App flushes the queue in an effect AFTER React commits the panel-map change
//   and AFTER the reference-raster store sync evicts the closed panel's entry
//   (releaseQueuedRasterBuffersSkippingShared). The queue/hold notifications
//   below re-render App so a flush always follows new release work.
// - A buffer is NEVER detached while anything can still read it: bands shared
//   by reference with a live panel or a remembered raster (the same
//   distinct-buffer dedup as sumLiveRasterBytesAcrossSources), and sources held
//   by long-running async flows (an apply's captured source, an export in
//   progress) are skipped and re-examined on the next flush.

const pendingReleaseRasters = new Set<RasterImage>();
const activeSourceHolds = new Set<{ readonly source: ViewportImageSource }>();
const releaseWorkListeners = new Set<() => void>();
let releaseWorkVersion = 0;

export function queueOutgoingRasterSourceForBufferRelease(
  source: ViewportImageSource | undefined,
): void {
  if (!source || source.kind !== "raster") return;
  pendingReleaseRasters.add(source.raster);
  notifyReleaseWorkChanged();
}

// Long-running async flows that captured a source (a running transform, an
// export encoding chunks from it) register a hold so a concurrent replace of
// the same panel cannot detach the buffers out from under them. Release the
// hold in a finally; the release triggers a flush so the deferred detach
// still happens deterministically.
export function holdSourceBuffersWhileInUse(source: ViewportImageSource): () => void {
  const hold = { source };
  activeSourceHolds.add(hold);
  return () => {
    activeSourceHolds.delete(hold);
    notifyReleaseWorkChanged();
  };
}

export function holdSourcesBuffersWhileInUse(
  sources: Iterable<ViewportImageSource>,
): () => void {
  const releases = [...sources].map((source) => holdSourceBuffersWhileInUse(source));
  return () => releases.forEach((release) => release());
}

export interface SharedBufferSources {
  readonly liveSources: Iterable<ViewportImageSource>;
  readonly rememberedRasters: Iterable<RasterImage>;
  readonly rememberedBuffers?: Iterable<ArrayBufferLike>;
}

export function releaseQueuedRasterBuffersSkippingShared(shared: SharedBufferSources): void {
  const sharedBuffers = collectSharedBuffers(shared);
  for (const raster of [...pendingReleaseRasters]) {
    if (detachRasterBandBuffersReturningWhetherSettled(raster, sharedBuffers)) {
      pendingReleaseRasters.delete(raster);
    }
  }
}

export function countPendingRasterBufferReleases(): number {
  return pendingReleaseRasters.size;
}

export function subscribeToRasterBufferReleaseWork(listener: () => void): () => void {
  releaseWorkListeners.add(listener);
  return () => {
    releaseWorkListeners.delete(listener);
  };
}

export function readRasterBufferReleaseWorkVersion(): number {
  return releaseWorkVersion;
}

export function resetRasterBufferReleaseStateForTests(): void {
  pendingReleaseRasters.clear();
  activeSourceHolds.clear();
  releaseWorkListeners.clear();
}

function notifyReleaseWorkChanged(): void {
  releaseWorkVersion += 1;
  for (const listener of [...releaseWorkListeners]) listener();
}

function collectSharedBuffers(shared: SharedBufferSources): Set<ArrayBufferLike> {
  const buffers = new Set<ArrayBufferLike>();
  addBackingBuffersOfSources(shared.liveSources, buffers);
  addBackingBuffersOfSources(listHeldSources(), buffers);
  for (const raster of shared.rememberedRasters) addRasterBandBuffers(raster, buffers);
  for (const buffer of shared.rememberedBuffers ?? []) buffers.add(buffer);
  return buffers;
}

function listHeldSources(): ViewportImageSource[] {
  return [...activeSourceHolds].map((hold) => hold.source);
}

function addBackingBuffersOfSources(
  sources: Iterable<ViewportImageSource>,
  buffers: Set<ArrayBufferLike>,
): void {
  for (const source of sources) {
    for (const buffer of listSourceBackingBuffers(source)) buffers.add(buffer);
  }
}

function addRasterBandBuffers(raster: RasterImage, buffers: Set<ArrayBufferLike>): void {
  for (const band of raster.bandPixels) buffers.add(band.buffer);
}

// Returns true when every buffer is settled (detached now or previously, or
// not transferable); a raster with a buffer skipped because something still
// shares it stays pending and is re-examined on the next flush.
function detachRasterBandBuffersReturningWhetherSettled(
  raster: RasterImage,
  sharedBuffers: ReadonlySet<ArrayBufferLike>,
): boolean {
  let everyBufferSettled = true;
  for (const band of raster.bandPixels) {
    const settled = detachBufferUnlessShared(band.buffer, sharedBuffers);
    everyBufferSettled = settled && everyBufferSettled;
  }
  return everyBufferSettled;
}

function detachBufferUnlessShared(
  buffer: ArrayBufferLike,
  sharedBuffers: ReadonlySet<ArrayBufferLike>,
): boolean {
  if (!(buffer instanceof ArrayBuffer) || buffer.detached) return true;
  if (sharedBuffers.has(buffer)) {
    recordSkippedSharedRasterBuffer();
    return false;
  }
  detachBufferReturningItsBackingStoreToThePool(buffer);
  return true;
}

// transfer(0) detaches the buffer and shrinks its backing store to zero bytes,
// so the pool space comes back NOW instead of at a GC that may never run.
function detachBufferReturningItsBackingStoreToThePool(buffer: ArrayBuffer): void {
  const byteLength = buffer.byteLength;
  buffer.transfer(0);
  recordDetachedRasterBuffer(byteLength);
}
