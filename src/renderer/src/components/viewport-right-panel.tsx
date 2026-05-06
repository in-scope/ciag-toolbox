import { useMemo, useId } from "react";

import {
  formatOperationHistoryParameterValuesAsInlineText,
  formatOperationHistoryTimestampForDisplay,
  type ViewportOperationHistory,
  type ViewportOperationHistoryEntry,
} from "@/lib/actions/operation-history";
import type { ViewportImageMetadataDisplay } from "@/lib/image/image-metadata-display";
import {
  clampBandIndexToRaster,
  getRasterBandLabelOrDefault,
  type RasterImage,
} from "@/lib/image/raster-image";
import { cn } from "@/lib/utils";

export interface ViewportRightPanelActiveSource {
  readonly viewportNumber: number;
  readonly metadata: ViewportImageMetadataDisplay | null;
  readonly raster: RasterImage | null;
  readonly selectedBandIndex: number;
  readonly onSelectBandIndex: (bandIndex: number) => void;
  readonly operationHistory: ViewportOperationHistory;
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
  const sections: JSX.Element[] = [];
  if (activeSource) {
    sections.push(<MetadataSection key="metadata" activeSource={activeSource} />);
  }
  if (shouldShowBandsSection(activeSource)) {
    sections.push(<BandsSection key="bands" activeSource={activeSource!} />);
  }
  if (shouldShowHistorySection(activeSource)) {
    sections.push(<HistorySection key="history" activeSource={activeSource!} />);
  }
  return sections;
}

function shouldShowBandsSection(
  activeSource: ViewportRightPanelActiveSource | null,
): boolean {
  if (!activeSource || !activeSource.raster) return false;
  return activeSource.raster.bandCount > 1;
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

interface BandsSectionProps {
  activeSource: ViewportRightPanelActiveSource;
}

function BandsSection(props: BandsSectionProps): JSX.Element | null {
  const radioGroupName = useId();
  if (!props.activeSource.raster) return null;
  const displayedBandIndex = clampBandIndexToRaster(
    props.activeSource.raster,
    props.activeSource.selectedBandIndex,
  );
  return (
    <section aria-label="Bands" className="flex flex-col gap-2">
      <BandsSectionHeader viewportNumber={props.activeSource.viewportNumber} />
      <BandsRadioList
        raster={props.activeSource.raster}
        selectedBandIndex={displayedBandIndex}
        radioGroupName={radioGroupName}
        onSelectBandIndex={props.activeSource.onSelectBandIndex}
      />
    </section>
  );
}

function BandsSectionHeader({ viewportNumber }: { viewportNumber: number }): JSX.Element {
  return (
    <header className="flex items-baseline justify-between">
      <h2 className="text-sm font-medium text-foreground">Bands</h2>
      <span className="text-xs text-muted-foreground">Viewport {viewportNumber}</span>
    </header>
  );
}

interface BandsRadioListProps {
  raster: RasterImage;
  selectedBandIndex: number;
  radioGroupName: string;
  onSelectBandIndex: (bandIndex: number) => void;
}

function BandsRadioList(props: BandsRadioListProps): JSX.Element {
  const items = useMemo(
    () => buildBandRadioItems(props.raster),
    [props.raster],
  );
  return (
    <ul role="radiogroup" aria-label="Display band" className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.bandIndex}>
          <BandRadioOption
            item={item}
            isSelected={item.bandIndex === props.selectedBandIndex}
            radioGroupName={props.radioGroupName}
            onSelect={() => props.onSelectBandIndex(item.bandIndex)}
          />
        </li>
      ))}
    </ul>
  );
}

interface BandRadioItem {
  readonly bandIndex: number;
  readonly label: string;
}

function buildBandRadioItems(raster: RasterImage): ReadonlyArray<BandRadioItem> {
  const items: BandRadioItem[] = [];
  for (let bandIndex = 0; bandIndex < raster.bandCount; bandIndex++) {
    items.push({ bandIndex, label: getRasterBandLabelOrDefault(raster, bandIndex) });
  }
  return items;
}

interface BandRadioOptionProps {
  item: BandRadioItem;
  isSelected: boolean;
  radioGroupName: string;
  onSelect: () => void;
}

function BandRadioOption(props: BandRadioOptionProps): JSX.Element {
  return (
    <label className={getBandRadioRowClassName(props.isSelected)}>
      <input
        type="radio"
        className="size-4 cursor-pointer accent-primary"
        name={props.radioGroupName}
        checked={props.isSelected}
        onChange={props.onSelect}
      />
      <span className="truncate text-sm" title={props.item.label}>
        {props.item.label}
      </span>
    </label>
  );
}

function getBandRadioRowClassName(isSelected: boolean): string {
  return cn(
    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent",
    isSelected && "bg-accent/60 text-foreground",
    !isSelected && "text-muted-foreground",
  );
}

interface HistorySectionProps {
  activeSource: ViewportRightPanelActiveSource;
}

function HistorySection(props: HistorySectionProps): JSX.Element {
  return (
    <section aria-label="History" className="flex flex-col gap-2">
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
    <section aria-label="Metadata" className="flex flex-col gap-2">
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
