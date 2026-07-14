import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-239: the renderer-wide raster memory budget.
//
// MEASURED PLATFORM CAP (probe 2026-07-14, Electron 33.2.1, Windows): every
// ArrayBuffer backing store lives inside the V8 sandbox's PartitionAlloc pool,
// and a fresh renderer can allocate exactly 17,000,000,000 bytes of typed
// arrays before allocation fails with a catchable RangeError. This is a hard
// per-process address-space cap: it does not grow with system RAM or the
// pagefile, and it sits ON TOP of the known 2 GiB single-allocation cap.
//
// Every flow that materializes cube-scale arrays (opens, panel duplication,
// operation applies) must therefore check its allocation against the room the
// pool has left BEFORE allocating, and refuse with an in-vocabulary message
// instead of surfacing the raw allocator error mid-way through the work.
export const RENDERER_ARRAY_BUFFER_POOL_BYTES = 17_000_000_000;

// Room reserved for everything the budget cannot see: the app's baseline
// buffers, 64 MiB protocol read chunks, histogram/spectra tallies, encode and
// GPU-upload staging, and per-operation transients (e.g. the percentile sort
// copy). Sized from at-scale evidence (CT-239 sweep, 2026-07-14): a live
// session with a 5 GB stack open failed a further ~10.4 GB of allocations
// (~15.4 GB of accounted cube demand) while ~15.0 GB succeeded, so roughly
// 2 GB of the bare-window pool is consumed by unaccounted session state and
// another ~0.5 GB must stay free for operation transients.
const TRANSIENT_ALLOCATION_SAFETY_MARGIN_BYTES = 2_500_000_000;

export const USABLE_RASTER_MEMORY_BUDGET_BYTES =
  RENDERER_ARRAY_BUFFER_POOL_BYTES - TRANSIENT_ALLOCATION_SAFETY_MARGIN_BYTES;

export const OPERATION_MEMORY_REFUSAL_MESSAGE =
  "There is not enough memory for this operation with the current panels open. " +
  "Close panels you no longer need, use a band-wise scope, or crop the stack and try again.";

export const OPEN_IMAGES_MEMORY_REFUSAL_MESSAGE =
  "There is not enough memory to open these files with the current panels open. " +
  "Close panels you no longer need and try again.";

export const DUPLICATE_MEMORY_REFUSAL_MESSAGE =
  "There is not enough memory to duplicate this panel. " +
  "Close panels you no longer need and try again.";

export function buildOpenSingleImageMemoryRefusalMessage(fileName: string): string {
  return (
    `There is not enough memory to open ${fileName} with the current panels open. ` +
    "Close panels you no longer need and try again."
  );
}

// Live bytes are counted over DISTINCT backing buffers: operation results share
// unchanged bands with their sources by reference (CT-103/CT-233), and a
// shared band must not be billed once per panel.
export function sumLiveRasterBytesAcrossSources(
  sources: Iterable<ViewportImageSource>,
): number {
  const countedBuffers = new Set<ArrayBufferLike>();
  let totalBytes = 0;
  for (const source of sources) {
    totalBytes += sumSourceBytesSkippingCountedBuffers(source, countedBuffers);
  }
  return totalBytes;
}

function sumSourceBytesSkippingCountedBuffers(
  source: ViewportImageSource,
  countedBuffers: Set<ArrayBufferLike>,
): number {
  if (source.kind === "raster") {
    return sumRasterBytesSkippingCountedBuffers(source.raster, countedBuffers);
  }
  if (source.kind === "pixels") {
    return sumBufferBytesOnce(source.pixels.buffer, countedBuffers);
  }
  return 0;
}

function sumRasterBytesSkippingCountedBuffers(
  raster: RasterImage,
  countedBuffers: Set<ArrayBufferLike>,
): number {
  let totalBytes = 0;
  for (const band of raster.bandPixels) {
    totalBytes += sumBufferBytesOnce(band.buffer, countedBuffers);
  }
  return totalBytes;
}

function sumBufferBytesOnce(
  buffer: ArrayBufferLike,
  countedBuffers: Set<ArrayBufferLike>,
): number {
  if (countedBuffers.has(buffer)) return 0;
  countedBuffers.add(buffer);
  return buffer.byteLength;
}

export function remainingRasterMemoryBudgetBytes(liveRasterBytes: number): number {
  return Math.max(0, USABLE_RASTER_MEMORY_BUDGET_BYTES - liveRasterBytes);
}

export function rasterAllocationExceedsMemoryBudget(
  allocationBytes: number,
  liveRasterBytes: number,
): boolean {
  return allocationBytes > remainingRasterMemoryBudgetBytes(liveRasterBytes);
}

export function assertRasterAllocationFitsMemoryBudget(
  allocationBytes: number,
  liveRasterBytes: number,
  refusalMessage: string,
): void {
  if (!rasterAllocationExceedsMemoryBudget(allocationBytes, liveRasterBytes)) return;
  throw new Error(refusalMessage);
}

// For flows that snapshot the remaining budget once and thread it down (the
// open paths, where live bytes are counted at the flow entry in App).
export function assertAllocationFitsRemainingBudget(
  allocationBytes: number,
  remainingBudgetBytes: number,
  refusalMessage: string,
): void {
  if (allocationBytes <= remainingBudgetBytes) return;
  throw new Error(refusalMessage);
}
