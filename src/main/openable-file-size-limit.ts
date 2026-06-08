import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

const BYTES_PER_GIBIBYTE = 1024 * 1024 * 1024;

/**
 * Maximum size of a single file the application will read fully into memory when
 * opening an image. Every byte-read open path funnels through
 * {@link readFileWithinOpenableSizeLimitOrThrow}: the primary Open Image(s) flow,
 * viewport re-import, and bundle-asset reads.
 *
 * Set to 16 GiB. Real MSI/HSI cubes routinely run to several gigabytes and Wallace
 * asked for headroom of at least 16 GB (CT-070).
 *
 * Why 16 GiB is safe to read and what it assumes (the buffer/allocation contract):
 * - Node's `Buffer.constants.MAX_LENGTH` on 64-bit is 2^53-1 bytes, far above 16 GiB,
 *   so `fs.readFile` returns the whole file without truncating (no
 *   `ERR_FS_FILE_TOO_LARGE`) and `new Uint8Array(buffer)` views all of it.
 * - JavaScript array/length values up to 2^53-1 are exact integers, so a 16 GiB length
 *   is never silently rounded or wrapped while the bytes flow through the loaders.
 * - V8 (Electron's engine) permits a single ArrayBuffer up to 2^53-1 bytes on 64-bit,
 *   so the bytes can cross the open-dialog IPC channel via structured clone.
 * - The real constraint is RAM, not a hard engine cap: opening peaks at roughly two
 *   copies of the file (one in the main process, one transient structured-clone copy in
 *   the renderer) plus the decoded raster. This guard exists to turn an out-of-memory
 *   renderer crash (white screen, see CT-061) into a clear, catchable error first.
 *
 * Override at runtime with the `CT_MAX_OPENABLE_FILE_BYTES` environment variable
 * (a positive integer number of bytes).
 */
export const DEFAULT_MAX_OPENABLE_FILE_BYTES = 16 * BYTES_PER_GIBIBYTE;

const MAX_OPENABLE_FILE_BYTES_ENV_VAR = "CT_MAX_OPENABLE_FILE_BYTES";

export function resolveMaxOpenableFileBytes(): number {
  const override = parsePositiveIntegerBytesOrNull(
    process.env[MAX_OPENABLE_FILE_BYTES_ENV_VAR],
  );
  return override ?? DEFAULT_MAX_OPENABLE_FILE_BYTES;
}

function parsePositiveIntegerBytesOrNull(rawValue: string | undefined): number | null {
  if (rawValue === undefined) return null;
  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function isFileSizeWithinOpenableLimit(
  sizeBytes: number,
  limitBytes: number,
): boolean {
  return sizeBytes <= limitBytes;
}

export function describeFileSizeExceedsOpenableLimit(
  fileName: string,
  sizeBytes: number,
  limitBytes: number,
): string {
  return `${fileName} is ${formatBytesAsGigabytes(sizeBytes)}, which exceeds the ${formatBytesAsGigabytes(limitBytes)} maximum openable file size`;
}

function formatBytesAsGigabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_GIBIBYTE).toFixed(1)} GB`;
}

export async function readFileWithinOpenableSizeLimitOrThrow(
  filePath: string,
): Promise<Uint8Array> {
  await throwIfFilePathExceedsOpenableSizeLimit(filePath);
  const buffer = await readFile(filePath);
  return new Uint8Array(buffer);
}

async function throwIfFilePathExceedsOpenableSizeLimit(filePath: string): Promise<void> {
  const limitBytes = resolveMaxOpenableFileBytes();
  const stats = await stat(filePath);
  if (isFileSizeWithinOpenableLimit(stats.size, limitBytes)) return;
  throw new Error(
    describeFileSizeExceedsOpenableLimit(basename(filePath), stats.size, limitBytes),
  );
}
