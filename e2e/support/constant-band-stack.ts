import { expect } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import { enqueueAndTriggerOpenImages } from "./open-images-flow";
import { panelCanvas, panelGrid } from "./panels";
import { statusBar } from "./pixel-readout";

// CT-220/CT-221: runtime-generated large multiband uint16 TIFFs (NOT committed) big
// enough that loading or transforming them reliably outlasts the busy indicator's
// anti-flash delay. Every band holds ONE constant value (band N reads N * 100 at
// every pixel), so ANY hovered pixel is an exact oracle without sub-pixel hovering.

export interface ConstantBandStackSpec {
  readonly fileName: string;
  readonly width: number;
  readonly height: number;
  readonly bandCount: number;
}

// Sized so the single-file decode shows the determinate loading overlay for seconds.
export const LOADING_PROGRESS_STACK: ConstantBandStackSpec = {
  fileName: "loading-progress-stack.tif",
  width: 3200,
  height: 2400,
  bandCount: 16,
};

// Sized so a full-stack median denoise shows the determinate operation overlay for
// seconds without making the spec run for minutes.
export const OPERATION_PROGRESS_STACK: ConstantBandStackSpec = {
  fileName: "operation-progress-stack.tif",
  width: 2000,
  height: 1500,
  bandCount: 12,
};

export function constantBandStackValueForBand(bandIndexZeroBased: number): number {
  return (bandIndexZeroBased + 1) * 100;
}

export interface GeneratedConstantBandStack {
  readonly filePath: string;
  readonly directory: string;
}

export async function writeTemporaryConstantBandStackTiff(
  spec: ConstantBandStackSpec,
): Promise<GeneratedConstantBandStack> {
  const directory = await mkdtemp(join(tmpdir(), "msi-e2e-constant-stack-"));
  const filePath = join(directory, spec.fileName);
  await writeFile(filePath, Buffer.concat(buildMultiPageTiffBuffers(spec)));
  return { filePath, directory };
}

export async function openGeneratedStackAndAwaitLoad(
  page: Page,
  spec: ConstantBandStackSpec,
  generated: GeneratedConstantBandStack,
  timeoutMs: number,
): Promise<void> {
  await enqueueAndTriggerOpenImages(page, [generated.filePath]);
  await expect(panelGrid(page).getByText(spec.fileName, { exact: false }).first()).toBeVisible({
    timeout: timeoutMs,
  });
  await expect(
    panelGrid(page).getByRole("status", { name: `Reading ${spec.fileName}...` }),
  ).toBeHidden({ timeout: timeoutMs });
}

// Every pixel of a band holds the same value, so the oracle does not need an exact
// pixel hover at large-image fit-view scale: whatever pixel the status bar reports
// must read the band constant.
export async function readAnyHoveredPixelValue(page: Page, panelNumber: number): Promise<number> {
  const box = await panelCanvas(page, panelNumber).boundingBox();
  if (!box) throw new Error(`Panel ${panelNumber} canvas has no bounding box`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await hoverNearCanvasCenter(page, box, attempt);
    const value = await tryReadPixelReadoutValueOrNull(page);
    if (value !== null) return value;
  }
  throw new Error("Pixel readout never populated while hovering the loaded panel");
}

interface CanvasBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function hoverNearCanvasCenter(page: Page, box: CanvasBox, attempt: number): Promise<void> {
  const nudgeX = attempt % 5;
  const nudgeY = Math.floor(attempt / 5) % 3;
  await page.mouse.move(box.x + box.width / 2 + nudgeX, box.y + box.height / 2 + nudgeY);
  await page.waitForTimeout(60);
}

async function tryReadPixelReadoutValueOrNull(page: Page): Promise<number | null> {
  const valueField = statusBar(page).getByTestId("pixel-readout-value");
  if ((await valueField.count()) === 0) return null;
  const value = Number.parseFloat((await valueField.innerText()).trim().replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

// Classic little-endian TIFF, one IFD immediately followed by one uncompressed strip
// per band - the same layout as e2e/fixtures/generate-fixtures.mjs and
// scripts/generate-scale-audit-stack.mjs.

const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;
const TIFF_ENTRY_COUNT = 10;
const TIFF_IFD_BYTE_SIZE = 2 + TIFF_ENTRY_COUNT * 12 + 4;
const TIFF_FIRST_IFD_OFFSET = 8;

interface TiffIfdEntry {
  readonly tag: number;
  readonly type: number;
  readonly value: number;
}

function buildMultiPageTiffBuffers(spec: ConstantBandStackSpec): Buffer[] {
  const buffers = [encodeLittleEndianTiffHeader()];
  for (let bandIndex = 0; bandIndex < spec.bandCount; bandIndex += 1) {
    buffers.push(encodeIfdForBand(spec, bandIndex), encodeConstantBandStrip(spec, bandIndex));
  }
  return buffers;
}

function encodeLittleEndianTiffHeader(): Buffer {
  const header = Buffer.alloc(TIFF_FIRST_IFD_OFFSET);
  header.write("II", 0, "ascii");
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(TIFF_FIRST_IFD_OFFSET, 4);
  return header;
}

function computePageBlockSize(spec: ConstantBandStackSpec): number {
  return TIFF_IFD_BYTE_SIZE + spec.width * spec.height * 2;
}

function computeIfdOffsetForBand(spec: ConstantBandStackSpec, bandIndex: number): number {
  return TIFF_FIRST_IFD_OFFSET + bandIndex * computePageBlockSize(spec);
}

function encodeIfdForBand(spec: ConstantBandStackSpec, bandIndex: number): Buffer {
  const ifdOffset = computeIfdOffsetForBand(spec, bandIndex);
  const stripOffset = ifdOffset + TIFF_IFD_BYTE_SIZE;
  const isLastBand = bandIndex === spec.bandCount - 1;
  const nextIfdOffset = isLastBand ? 0 : computeIfdOffsetForBand(spec, bandIndex + 1);
  return encodeIfdBytes(buildTiffPageEntries(spec, stripOffset), nextIfdOffset);
}

function buildTiffPageEntries(spec: ConstantBandStackSpec, stripOffset: number): TiffIfdEntry[] {
  return [
    { tag: 256, type: TIFF_TYPE_SHORT, value: spec.width },
    { tag: 257, type: TIFF_TYPE_SHORT, value: spec.height },
    { tag: 258, type: TIFF_TYPE_SHORT, value: 16 },
    { tag: 259, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 262, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 273, type: TIFF_TYPE_LONG, value: stripOffset },
    { tag: 277, type: TIFF_TYPE_SHORT, value: 1 },
    { tag: 278, type: TIFF_TYPE_LONG, value: spec.height },
    { tag: 279, type: TIFF_TYPE_LONG, value: spec.width * spec.height * 2 },
    { tag: 339, type: TIFF_TYPE_SHORT, value: 1 },
  ];
}

function encodeIfdBytes(entries: ReadonlyArray<TiffIfdEntry>, nextIfdOffset: number): Buffer {
  const bytes = Buffer.alloc(TIFF_IFD_BYTE_SIZE);
  bytes.writeUInt16LE(entries.length, 0);
  entries.forEach((entry, entryIndex) => writeIfdEntry(bytes, 2 + entryIndex * 12, entry));
  bytes.writeUInt32LE(nextIfdOffset, 2 + entries.length * 12);
  return bytes;
}

function writeIfdEntry(bytes: Buffer, offset: number, entry: TiffIfdEntry): void {
  bytes.writeUInt16LE(entry.tag, offset);
  bytes.writeUInt16LE(entry.type, offset + 2);
  bytes.writeUInt32LE(1, offset + 4);
  if (entry.type === TIFF_TYPE_SHORT) bytes.writeUInt16LE(entry.value, offset + 8);
  else bytes.writeUInt32LE(entry.value, offset + 8);
}

function encodeConstantBandStrip(spec: ConstantBandStackSpec, bandIndex: number): Buffer {
  const sampleCount = spec.width * spec.height;
  const samples = new Uint16Array(sampleCount);
  samples.fill(constantBandStackValueForBand(bandIndex));
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}
