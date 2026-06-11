import { useMemo } from "react";

import {
  HistogramSection,
  shouldShowHistogramSection,
} from "@/components/histogram-section";
import {
  listVisibleRightPanelSectionKeys,
  type RightPanelSectionKey,
  type RightPanelSectionVisibility,
} from "@/components/right-panel-section-keys";
import {
  SpectrumPlot,
  type SpectrumLinePlotInput,
} from "@/components/spectrum-plot";
import {
  SubsetBandsSection,
  type SubsetBandsApplyOptions,
} from "@/components/subset-bands-section";
import { Button } from "@/components/ui/button";
import {
  formatOperationHistoryParameterValuesAsInlineText,
  formatOperationHistoryTimestampForDisplay,
  type ViewportOperationHistory,
  type ViewportOperationHistoryEntry,
} from "@/lib/actions/operation-history";
import type { ViewportImageMetadataDisplay } from "@/lib/image/image-metadata-display";
import {
  clampBandIndexToRaster,
  type RasterImage,
  type RasterSampleFormat,
} from "@/lib/image/raster-image";
import type { BandRun } from "@/lib/image/spectrum-band-gaps";
import {
  buildSpectrumXAxisFromRaster,
  describeSpectrumYAxisLabel,
} from "@/lib/image/spectrum-axis";
import {
  MAX_PINNED_SPECTRA_PER_VIEWPORT,
  type PinnedRoiMeanSpectrum,
  type PinnedRoiSpectraList,
  type PinnedSpectrum,
  type PinnedSpectraList,
} from "@/lib/image/spectrum-entry";
import { buildLiveHoverSpectrumLineOrNull } from "@/lib/image/spectrum-plot-line-set";
import {
  formatViewportRoiCornerLabel,
  formatViewportRoiSizeLabel,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";
import { cn } from "@/lib/utils";
import {
  useCurrentPixelReadoutSnapshot,
  type ViewportPixelReadoutSnapshot,
} from "@/state/pixel-readout-context";

export type ViewportRightPanelImageSourceKind = "raster" | "browser-source";

export interface ViewportRightPanelActiveSource {
  readonly viewportIndex: number;
  readonly viewportNumber: number;
  readonly metadata: ViewportImageMetadataDisplay | null;
  readonly raster: RasterImage | null;
  readonly imageSourceKind: ViewportRightPanelImageSourceKind | null;
  readonly selectedBandIndex: number;
  readonly onSelectBandIndex: (bandIndex: number) => void;
  readonly removedBandIndexes: ReadonlyArray<number>;
  readonly isBandSubsetEditModeActive: boolean;
  readonly onEnterBandSubsetEditMode: () => void;
  readonly onExitBandSubsetEditMode: () => void;
  readonly onApplyBandSubset: (options: SubsetBandsApplyOptions) => void;
  readonly operationHistory: ViewportOperationHistory;
  readonly roi: ViewportRoi | null;
  readonly onClearRoi: () => void;
  readonly pinnedSpectra: PinnedSpectraList;
  readonly pinnedRoiSpectra: PinnedRoiSpectraList;
  readonly activeRoiMeanSpectrum: RoiMeanSpectrumForDisplay | null;
  readonly onRemovePinnedSpectrum: (spectrumId: string) => void;
  readonly onRemovePinnedRoiSpectrum: (spectrumId: string) => void;
}

export interface RoiMeanSpectrumForDisplay {
  readonly bandMeans: ReadonlyArray<number>;
  readonly bandStandardDeviations: ReadonlyArray<number>;
  readonly samplePixelCount: number;
}

interface ViewportRightPanelProps {
  activeSource: ViewportRightPanelActiveSource | null;
}

export function ViewportRightPanel(props: ViewportRightPanelProps): JSX.Element | null {
  const sectionsToRender = collectVisibleRightPanelSections(props.activeSource);
  if (sectionsToRender.length === 0) return null;
  return <RightPanelShell>{sectionsToRender}</RightPanelShell>;
}

function collectVisibleRightPanelSections(
  activeSource: ViewportRightPanelActiveSource | null,
): JSX.Element[] {
  const visibility = describeRightPanelSectionVisibility(activeSource);
  return listVisibleRightPanelSectionKeys(visibility).map((key) =>
    renderRightPanelSectionForKey(key, activeSource!),
  );
}

function describeRightPanelSectionVisibility(
  activeSource: ViewportRightPanelActiveSource | null,
): RightPanelSectionVisibility {
  return {
    hasActiveSource: activeSource !== null,
    showSubsetBandsEditor: shouldShowSubsetBandsEditor(activeSource),
    showHistogram: activeSource !== null && shouldShowHistogramSection(activeSource),
    showSpectra: shouldShowSpectraSection(activeSource),
    showRegion: shouldShowRegionSection(activeSource),
    showHistory: shouldShowHistorySection(activeSource),
  };
}

function renderRightPanelSectionForKey(
  key: RightPanelSectionKey,
  activeSource: ViewportRightPanelActiveSource,
): JSX.Element {
  if (key === "metadata") return <MetadataSection key={key} activeSource={activeSource} />;
  if (key === "subset-bands") {
    return <SubsetBandsSectionForActiveSource key={key} activeSource={activeSource} raster={activeSource.raster!} />;
  }
  if (key === "histogram") return <HistogramSection key={key} activeSource={activeSource} />;
  if (key === "spectra") return <SpectraSection key={key} activeSource={activeSource} />;
  if (key === "region") return <RegionSection key={key} activeSource={activeSource} />;
  return <HistorySection key={key} activeSource={activeSource} />;
}

function shouldShowSubsetBandsEditor(
  activeSource: ViewportRightPanelActiveSource | null,
): boolean {
  if (!activeSource || !activeSource.raster) return false;
  return activeSource.isBandSubsetEditModeActive;
}

function shouldShowSpectraSection(
  activeSource: ViewportRightPanelActiveSource | null,
): boolean {
  if (!activeSource || !activeSource.raster) return false;
  return activeSource.raster.bandCount > 1;
}

function shouldShowRegionSection(
  activeSource: ViewportRightPanelActiveSource | null,
): boolean {
  if (!activeSource) return false;
  return activeSource.roi !== null;
}

function shouldShowHistorySection(
  activeSource: ViewportRightPanelActiveSource | null,
): boolean {
  if (!activeSource) return false;
  return activeSource.operationHistory.length > 0;
}

function RightPanelShell(props: { children: ReadonlyArray<JSX.Element> }): JSX.Element {
  return (
    <aside aria-label="Viewport details panel" className={RIGHT_PANEL_CLASSES}>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">{props.children}</div>
    </aside>
  );
}

const RIGHT_PANEL_CLASSES = "flex w-[300px] shrink-0 flex-col border-l bg-card";

const RIGHT_PANEL_SECTION_CLASSES =
  "flex flex-col gap-2 light:rounded-md light:border light:border-border light:p-3";

interface BandsSectionForActiveSourceProps {
  activeSource: ViewportRightPanelActiveSource;
  raster: RasterImage;
}

function SubsetBandsSectionForActiveSource(
  props: BandsSectionForActiveSourceProps,
): JSX.Element {
  const displayedBandIndex = clampBandIndexToRaster(
    props.raster,
    props.activeSource.selectedBandIndex,
  );
  return (
    <SubsetBandsSection
      raster={props.raster}
      viewportNumber={props.activeSource.viewportNumber}
      activeBandIndex={displayedBandIndex}
      initialRemovedBandIndexes={props.activeSource.removedBandIndexes}
      onCancel={props.activeSource.onExitBandSubsetEditMode}
      onApply={props.activeSource.onApplyBandSubset}
    />
  );
}

interface HistorySectionProps {
  activeSource: ViewportRightPanelActiveSource;
}

function HistorySection(props: HistorySectionProps): JSX.Element {
  return (
    <section aria-label="History" className={RIGHT_PANEL_SECTION_CLASSES}>
      <HistorySectionHeader
        viewportNumber={props.activeSource.viewportNumber}
        entryCount={props.activeSource.operationHistory.length}
      />
      <HistoryEntryList history={props.activeSource.operationHistory} />
    </section>
  );
}

interface HistorySectionHeaderProps {
  viewportNumber: number;
  entryCount: number;
}

function HistorySectionHeader(props: HistorySectionHeaderProps): JSX.Element {
  return (
    <header className="flex items-baseline justify-between">
      <h2 className="text-sm font-medium text-foreground">History</h2>
      <span className="text-xs text-muted-foreground">
        {formatHistoryEntryCountLabel(props.entryCount, props.viewportNumber)}
      </span>
    </header>
  );
}

function formatHistoryEntryCountLabel(entryCount: number, viewportNumber: number): string {
  const noun = entryCount === 1 ? "operation" : "operations";
  return `${entryCount} ${noun}, viewport ${viewportNumber}`;
}

interface HistoryEntryListProps {
  history: ViewportOperationHistory;
}

function HistoryEntryList(props: HistoryEntryListProps): JSX.Element {
  return (
    <ol aria-label="Operation history" className="flex flex-col gap-1">
      {props.history.map((entry, position) => (
        <li key={`${entry.timestampMs}-${position}`}>
          <HistoryEntryRow entry={entry} />
        </li>
      ))}
    </ol>
  );
}

interface HistoryEntryRowProps {
  entry: ViewportOperationHistoryEntry;
}

function HistoryEntryRow(props: HistoryEntryRowProps): JSX.Element {
  const inlineParameters = formatOperationHistoryParameterValuesAsInlineText(
    props.entry.parameterValues,
  );
  const timestamp = formatOperationHistoryTimestampForDisplay(props.entry.timestampMs);
  return (
    <article className="flex flex-col gap-0.5 rounded-md border bg-background px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground" title={props.entry.actionLabel}>
          {props.entry.actionLabel}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">{timestamp}</span>
      </div>
      {inlineParameters ? (
        <span
          className="font-mono text-[11px] text-muted-foreground"
          title={inlineParameters}
        >
          {inlineParameters}
        </span>
      ) : null}
    </article>
  );
}

interface MetadataSectionProps {
  activeSource: ViewportRightPanelActiveSource;
}

function MetadataSection(props: MetadataSectionProps): JSX.Element {
  return (
    <section aria-label="Metadata" className={RIGHT_PANEL_SECTION_CLASSES}>
      <MetadataSectionHeader viewportNumber={props.activeSource.viewportNumber} />
      <MetadataSectionBody metadata={props.activeSource.metadata} />
    </section>
  );
}

function MetadataSectionHeader({ viewportNumber }: { viewportNumber: number }): JSX.Element {
  return (
    <header className="flex items-baseline justify-between">
      <h2 className="text-sm font-medium text-foreground">Metadata</h2>
      <span className="text-xs text-muted-foreground">Viewport {viewportNumber}</span>
    </header>
  );
}

function MetadataSectionBody({
  metadata,
}: {
  metadata: ViewportImageMetadataDisplay | null;
}): JSX.Element {
  if (!metadata) return <MetadataEmptyState />;
  return <MetadataKeyValueList metadata={metadata} />;
}

function MetadataEmptyState(): JSX.Element {
  return (
    <p className="text-xs text-muted-foreground">No image loaded in this viewport.</p>
  );
}

interface MetadataKeyValueListProps {
  metadata: ViewportImageMetadataDisplay;
}

function MetadataKeyValueList(props: MetadataKeyValueListProps): JSX.Element {
  const rows = buildMetadataRowsFromDisplay(props.metadata);
  return (
    <dl className="flex flex-col gap-1 text-xs">
      {rows.map((row) => (
        <MetadataKeyValueRow key={row.label} label={row.label} value={row.value} />
      ))}
    </dl>
  );
}

interface MetadataDisplayRow {
  readonly label: string;
  readonly value: string;
}

function buildMetadataRowsFromDisplay(
  metadata: ViewportImageMetadataDisplay,
): ReadonlyArray<MetadataDisplayRow> {
  return [
    { label: "File path", value: metadata.filePath },
    { label: "Format", value: metadata.format },
    { label: "Width", value: metadata.width },
    { label: "Height", value: metadata.height },
    { label: "Bits per sample", value: metadata.bitsPerSample },
    { label: "Sample format", value: metadata.sampleFormat },
    { label: "Bands", value: metadata.bandCount },
    { label: "File size", value: metadata.fileSize },
  ];
}

function MetadataKeyValueRow(props: MetadataDisplayRow): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{props.label}</dt>
      <dd
        className="truncate text-right font-mono text-foreground"
        title={props.value}
      >
        {props.value}
      </dd>
    </div>
  );
}

interface RegionSectionProps {
  activeSource: ViewportRightPanelActiveSource;
}

function RegionSection(props: RegionSectionProps): JSX.Element | null {
  const roi = props.activeSource.roi;
  if (!roi) return null;
  return (
    <section aria-label="Region" className={RIGHT_PANEL_SECTION_CLASSES}>
      <RegionSectionHeader
        viewportNumber={props.activeSource.viewportNumber}
        onClearRoi={props.activeSource.onClearRoi}
      />
      <RegionCoordinatesList roi={roi} />
    </section>
  );
}

interface RegionSectionHeaderProps {
  viewportNumber: number;
  onClearRoi: () => void;
}

function RegionSectionHeader(props: RegionSectionHeaderProps): JSX.Element {
  return (
    <header className="flex items-baseline justify-between">
      <h2 className="text-sm font-medium text-foreground">Region</h2>
      <Button
        variant="ghost"
        size="sm"
        className="-mr-2 h-6 px-2 text-xs text-muted-foreground"
        onClick={props.onClearRoi}
      >
        Clear
      </Button>
    </header>
  );
}

interface RegionCoordinatesListProps {
  roi: ViewportRoi;
}

function RegionCoordinatesList(props: RegionCoordinatesListProps): JSX.Element {
  return (
    <dl className="flex flex-col gap-1 text-xs">
      <RegionKeyValueRow label="Corners" value={formatViewportRoiCornerLabel(props.roi)} />
      <RegionKeyValueRow label="Size" value={formatViewportRoiSizeLabel(props.roi)} />
    </dl>
  );
}

interface RegionKeyValueRowProps {
  readonly label: string;
  readonly value: string;
}

function RegionKeyValueRow(props: RegionKeyValueRowProps): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{props.label}</dt>
      <dd className="truncate text-right font-mono text-foreground" title={props.value}>
        {props.value}
      </dd>
    </div>
  );
}

const SPECTRUM_LINE_COLOR_CLASSES: ReadonlyArray<string> = [
  "text-sky-400",
  "text-amber-400",
  "text-emerald-400",
  "text-rose-400",
  "text-violet-400",
];

const ROI_MEAN_SPECTRUM_COLOR_CLASSES: ReadonlyArray<string> = [
  "text-primary",
  "text-fuchsia-400",
];

function pickRoiSpectrumColorClassForIndex(index: number): string {
  return (
    ROI_MEAN_SPECTRUM_COLOR_CLASSES[index % ROI_MEAN_SPECTRUM_COLOR_CLASSES.length] ??
    "text-primary"
  );
}

interface SpectraSectionProps {
  activeSource: ViewportRightPanelActiveSource;
}

function SpectraSection(props: SpectraSectionProps): JSX.Element | null {
  const raster = props.activeSource.raster;
  const snapshot = useCurrentPixelReadoutSnapshot();
  const xAxis = useMemo(
    () => (raster ? buildSpectrumXAxisFromRaster(raster) : null),
    [raster],
  );
  if (!raster || !xAxis) return null;
  const yAxisLabel = describeSpectrumYAxisLabel(raster.sampleFormat);
  const hoverBandValues = readHoveredSpectrumBandValuesOrNull(
    snapshot,
    props.activeSource,
    raster.bandCount,
  );
  const lines = buildSpectrumPlotLinesFromActiveSource(props.activeSource, hoverBandValues);
  return (
    <section aria-label="Spectra" className={RIGHT_PANEL_SECTION_CLASSES}>
      <SpectraSectionHeader
        viewportNumber={props.activeSource.viewportNumber}
        pinnedCount={props.activeSource.pinnedSpectra.length}
      />
      {hasAnyPlottableLines(lines) ? (
        <SpectraSectionBody
          activeSource={props.activeSource}
          sampleFormat={raster.sampleFormat}
          lines={lines}
          xAxisLabel={xAxis.label}
          yAxisLabel={yAxisLabel}
          bandPositions={xAxis.bandPositions}
          bandRuns={xAxis.bandRuns}
          tickPositions={xAxis.tickPositions}
          tickLabels={xAxis.tickLabels}
        />
      ) : (
        <SpectraSectionEmptyState />
      )}
    </section>
  );
}

interface SpectraSectionHeaderProps {
  viewportNumber: number;
  pinnedCount: number;
}

function SpectraSectionHeader(props: SpectraSectionHeaderProps): JSX.Element {
  return (
    <header className="flex items-baseline justify-between">
      <h2 className="text-sm font-medium text-foreground">Spectra</h2>
      <span className="text-xs text-muted-foreground">
        {formatPinnedSpectraCountLabel(props.pinnedCount)}
      </span>
    </header>
  );
}

function formatPinnedSpectraCountLabel(pinnedCount: number): string {
  return `${pinnedCount} / ${MAX_PINNED_SPECTRA_PER_VIEWPORT} pinned`;
}

function hasAnyPlottableLines(lines: ReadonlyArray<SpectrumLinePlotInput>): boolean {
  return lines.some((line) => line.values.length > 0);
}

function SpectraSectionEmptyState(): JSX.Element {
  return (
    <p className="text-xs text-muted-foreground">
      Hover a pixel to preview its spectrum, click to pin it, or draw a region for its mean.
    </p>
  );
}

interface SpectraSectionBodyProps {
  activeSource: ViewportRightPanelActiveSource;
  sampleFormat: RasterSampleFormat;
  lines: ReadonlyArray<SpectrumLinePlotInput>;
  xAxisLabel: string;
  yAxisLabel: string;
  bandPositions: ReadonlyArray<number>;
  bandRuns: ReadonlyArray<BandRun>;
  tickPositions: ReadonlyArray<number>;
  tickLabels: ReadonlyArray<string>;
}

function SpectraSectionBody(props: SpectraSectionBodyProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background p-2">
      <SpectrumPlot
        bandPositions={props.bandPositions}
        bandRuns={props.bandRuns}
        tickPositions={props.tickPositions}
        tickLabels={props.tickLabels}
        xAxisLabel={props.xAxisLabel}
        yAxisLabel={props.yAxisLabel}
        lines={props.lines}
      />
      <SpectraLegend
        activeSource={props.activeSource}
        sampleFormat={props.sampleFormat}
      />
    </div>
  );
}

interface SpectraLegendProps {
  activeSource: ViewportRightPanelActiveSource;
  sampleFormat: RasterSampleFormat;
}

function SpectraLegend(props: SpectraLegendProps): JSX.Element {
  return (
    <ul className="flex flex-col gap-1 text-[11px]">
      {props.activeSource.pinnedRoiSpectra.map((spectrum, index) => (
        <SpectraLegendRoiMeanRow
          key={spectrum.id}
          spectrum={spectrum}
          label={formatRoiSpectrumLabel(index)}
          colorClass={pickRoiSpectrumColorClassForIndex(index)}
          onRemove={() => props.activeSource.onRemovePinnedRoiSpectrum(spectrum.id)}
        />
      ))}
      {props.activeSource.pinnedSpectra.map((spectrum, index) => (
        <SpectraLegendPinnedRow
          key={spectrum.id}
          spectrum={spectrum}
          colorClass={pickPinnedSpectrumColorClassForIndex(index)}
          onRemove={() => props.activeSource.onRemovePinnedSpectrum(spectrum.id)}
        />
      ))}
    </ul>
  );
}

function formatRoiSpectrumLabel(index: number): string {
  return `ROI ${index + 1}`;
}

function pickPinnedSpectrumColorClassForIndex(index: number): string {
  return SPECTRUM_LINE_COLOR_CLASSES[index % SPECTRUM_LINE_COLOR_CLASSES.length] ?? "text-foreground";
}

interface SpectraLegendPinnedRowProps {
  spectrum: PinnedSpectrum;
  colorClass: string;
  onRemove: () => void;
}

function SpectraLegendPinnedRow(props: SpectraLegendPinnedRowProps): JSX.Element {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <SpectrumColorSwatch colorClass={props.colorClass} />
        <span className="truncate font-mono">{describePinnedSpectrumForLegend(props.spectrum)}</span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 px-1.5 text-[11px] text-muted-foreground"
        onClick={props.onRemove}
        aria-label={`Remove pinned spectrum ${describePinnedSpectrumForLegend(props.spectrum)}`}
      >
        Remove
      </Button>
    </li>
  );
}

interface SpectraLegendRoiMeanRowProps {
  spectrum: PinnedRoiMeanSpectrum;
  label: string;
  colorClass: string;
  onRemove: () => void;
}

function SpectraLegendRoiMeanRow(props: SpectraLegendRoiMeanRowProps): JSX.Element {
  const description = `${props.label} mean (n=${props.spectrum.samplePixelCount}px) +/- 1 sigma`;
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <SpectrumColorSwatch colorClass={props.colorClass} />
        <span className="truncate font-mono">{description}</span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 px-1.5 text-[11px] text-muted-foreground"
        onClick={props.onRemove}
        aria-label={`Remove pinned spectrum ${description}`}
      >
        Remove
      </Button>
    </li>
  );
}

function SpectrumColorSwatch(props: { colorClass: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-2.5 w-2.5 rounded-full bg-current", props.colorClass)}
    />
  );
}

function describePinnedSpectrumForLegend(spectrum: PinnedSpectrum): string {
  if (spectrum.kind === "pixel") {
    return `Pixel (${spectrum.imagePixelX}, ${spectrum.imagePixelY})`;
  }
  return `ROI mean (n=${spectrum.samplePixelCount}px)`;
}

function buildSpectrumPlotLinesFromActiveSource(
  activeSource: ViewportRightPanelActiveSource,
  hoverBandValues: ReadonlyArray<number> | null,
): ReadonlyArray<SpectrumLinePlotInput> {
  const lines: SpectrumLinePlotInput[] = [];
  activeSource.pinnedRoiSpectra.forEach((spectrum, index) => {
    lines.push(buildRoiMeanSpectrumPlotLine(spectrum, index));
  });
  activeSource.pinnedSpectra.forEach((spectrum, index) => {
    lines.push(buildPinnedSpectrumPlotLine(spectrum, index));
  });
  const hoverLine = buildLiveHoverSpectrumLineOrNull(hoverBandValues);
  if (hoverLine) lines.push(hoverLine);
  return lines;
}

function readHoveredSpectrumBandValuesOrNull(
  snapshot: ViewportPixelReadoutSnapshot | null,
  activeSource: ViewportRightPanelActiveSource,
  bandCount: number,
): ReadonlyArray<number> | null {
  if (!snapshot || snapshot.viewportNumber !== activeSource.viewportNumber) return null;
  const values = snapshot.bands?.values ?? null;
  if (!values || values.length !== bandCount) return null;
  return values;
}

function buildRoiMeanSpectrumPlotLine(
  spectrum: PinnedRoiMeanSpectrum,
  index: number,
): SpectrumLinePlotInput {
  return {
    id: spectrum.id,
    colorClass: pickRoiSpectrumColorClassForIndex(index),
    values: spectrum.bandMeans,
    bandStandardDeviations: spectrum.bandStandardDeviations,
  };
}

function buildPinnedSpectrumPlotLine(
  spectrum: PinnedSpectrum,
  index: number,
): SpectrumLinePlotInput {
  return {
    id: spectrum.id,
    colorClass: pickPinnedSpectrumColorClassForIndex(index),
    values: spectrum.kind === "pixel" ? spectrum.bandValues : spectrum.bandMeans,
  };
}
