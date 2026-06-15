import type { Locator, Page } from "@playwright/test";

// The Metadata section (<section aria-label="Metadata">) renders a definition list:
// each row is <div><dt>{label}</dt><dd>{value}</dd></div>. The data type is reported
// across two rows ("Sample format" = uint|float, "Bits per sample" = 8|16|32), so the
// reader also exposes a combined dataType (e.g. "uint16", "float32"). "Original band"
// and "Wavelength" rows appear only for raster stacks (Wavelength only when present).

export interface MetadataReadout {
  readonly filePath: string;
  readonly format: string;
  readonly width: string;
  readonly height: string;
  readonly bitsPerSample: string;
  readonly sampleFormat: string;
  readonly bandCount: string;
  readonly fileSize: string;
  readonly dataType: string;
  readonly originalBand: string | null;
  readonly wavelength: string | null;
}

export function metadataSection(page: Page): Locator {
  return page.locator("section[aria-label='Metadata']");
}

export async function readMetadata(page: Page): Promise<MetadataReadout> {
  const section = metadataSection(page);
  const sampleFormat = await readMetadataRowValue(section, "Sample format");
  const bitsPerSample = await readMetadataRowValue(section, "Bits per sample");
  return {
    filePath: await readMetadataRowValue(section, "File path"),
    format: await readMetadataRowValue(section, "Format"),
    width: await readMetadataRowValue(section, "Width"),
    height: await readMetadataRowValue(section, "Height"),
    bitsPerSample,
    sampleFormat,
    bandCount: await readMetadataRowValue(section, "Bands"),
    fileSize: await readMetadataRowValue(section, "File size"),
    dataType: `${sampleFormat}${bitsPerSample}`,
    originalBand: await readMetadataRowValueOrNull(section, "Original band"),
    wavelength: await readMetadataRowValueOrNull(section, "Wavelength"),
  };
}

function metadataRowValueLocator(section: Locator, label: string): Locator {
  return section
    .locator("dt", { hasText: exactTextPattern(label) })
    .locator("xpath=following-sibling::dd[1]");
}

async function readMetadataRowValue(section: Locator, label: string): Promise<string> {
  return (await metadataRowValueLocator(section, label).innerText()).trim();
}

async function readMetadataRowValueOrNull(section: Locator, label: string): Promise<string | null> {
  const locator = metadataRowValueLocator(section, label);
  if ((await locator.count()) === 0) return null;
  return (await locator.innerText()).trim();
}

function exactTextPattern(label: string): RegExp {
  return new RegExp(`^${escapeRegExp(label)}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
