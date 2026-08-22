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

// The operation refusal copy is shared with the main process's user-script
// run gate (CT-241), so the string itself lives in src/shared.
export { OPERATION_MEMORY_REFUSAL_MESSAGE } from "@shared/memory-refusal-copy";

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
  let totalBytes = 0;
  for (const buffer of listSourceBackingBuffers(source)) {
    totalBytes += sumBufferBytesOnce(buffer, countedBuffers);
  }
  return totalBytes;
}

// The backing buffers a source contributes to the live set. Shared with the
// CT-290 buffer-release flush so "counts toward the budget" and "must not be
// detached" enumerate buffers identically.
export function listSourceBackingBuffers(source: ViewportImageSource): ArrayBufferLike[] {
  if (source.kind === "raster") return source.raster.bandPixels.map((band) => band.buffer);
  if (source.kind === "pixels") return [source.pixels.buffer];
  return [];
}

function sumBufferBytesOnce(
  buffer: ArrayBufferLike,
  countedBuffers: Set<ArrayBufferLike>,
): number {
  if (countedBuffers.has(buffer)) return 0;
  countedBuffers.add(buffer);
  return buffer.byteLength;
}

// CT-260 e2e test surface: the preload's e2e bridge can carry a lowered budget
// (see src/shared/e2e-memory-budget-argument.ts) so memory refusals are
// reproducible with tiny fixtures. The bridge only exists under
// --msi-e2e-test-mode, so production launches always use the measured budget.
interface WindowCarryingE2eBridge {
  readonly toolboxE2E?: { readonly memoryBudgetOverrideBytes?: number | null };
}

function readE2eMemoryBudgetOverrideBytesOrNull(): number | null {
  if (typeof window === "undefined") return null;
  return (window as WindowCarryingE2eBridge).toolboxE2E?.memoryBudgetOverrideBytes ?? null;
}

export function usableRasterMemoryBudgetBytes(): number {
  return readE2eMemoryBudgetOverrideBytesOrNull() ?? USABLE_RASTER_MEMORY_BUDGET_BYTES;
}

export function remainingRasterMemoryBudgetBytes(liveRasterBytes: number): number {
  return Math.max(0, usableRasterMemoryBudgetBytes() - liveRasterBytes);
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
