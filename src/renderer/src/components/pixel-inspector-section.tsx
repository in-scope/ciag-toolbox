import { ChevronDown } from "lucide-react";

import { BandIndexBadge } from "@/components/band-index-badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ViewportRightPanelActiveSource } from "@/components/viewport-right-panel";
import {
  buildBrowserSourcePixelInspectorRow,
  buildRasterPixelInspectorRows,
  type PixelInspectorRow as PixelInspectorRowValues,
} from "@/lib/image/build-pixel-inspector-rows";
import { computePerBandRawValueExtentsForRaster } from "@/lib/image/compute-image-channel-extents";
import {
  clampBandIndexToRaster,
  type RasterImage,
} from "@/lib/image/raster-image";
import { cn } from "@/lib/utils";
import { useRightPanelCollapsedSection } from "@/state/right-panel-collapsed-state";
import {
  useCurrentPixelReadoutSnapshot,
  type ViewportPixelReadoutSnapshot,
} from "@/state/pixel-readout-context";

interface PixelInspectorSectionProps {
  activeSource: ViewportRightPanelActiveSource;
}

export function PixelInspectorSection(props: PixelInspectorSectionProps): JSX.Element | null {
  if (!shouldShowPixelInspectorSection(props.activeSource)) return null;
  return <PixelInspectorSectionBody activeSource={props.activeSource} />;
}

export function shouldShowPixelInspectorSection(
  activeSource: ViewportRightPanelActiveSource,
): boolean {
  if (activeSource.raster && activeSource.raster.bandCount >= 1) return true;
  return activeSource.imageSourceKind === "browser-source";
}

function PixelInspectorSectionBody(props: PixelInspectorSectionProps): JSX.Element {
  const { isCollapsed, setCollapsed } = useRightPanelCollapsedSection("pixel-inspector");
  const snapshot = useCurrentPixelReadoutSnapshot();
  return (
    <Collapsible
      open={!isCollapsed}
      onOpenChange={(open) => setCollapsed(!open)}
      asChild
    >
      <section aria-label="Pixel Inspector" className={RIGHT_PANEL_SECTION_CLASSES}>
        <PixelInspectorSectionHeader
          viewportNumber={props.activeSource.viewportNumber}
          isCollapsed={isCollapsed}
        />
        <CollapsibleContent>
          <PixelInspectorRowList activeSource={props.activeSource} snapshot={snapshot} />
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

const RIGHT_PANEL_SECTION_CLASSES =
  "flex flex-col gap-2 light:rounded-md light:border light:border-border light:p-3";

interface PixelInspectorSectionHeaderProps {
  viewportNumber: number;
  isCollapsed: boolean;
}

function PixelInspectorSectionHeader(props: PixelInspectorSectionHeaderProps): JSX.Element {
  return (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        className="flex items-baseline justify-between rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-expanded={!props.isCollapsed}
      >
        <span className="flex items-center gap-1.5">
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-3 w-3 text-muted-foreground transition-transform",
              props.isCollapsed && "-rotate-90",
            )}
          />
          <h2 className="text-sm font-medium text-foreground">Pixel Inspector</h2>
        </span>
        <span className="text-xs text-muted-foreground">Viewport {props.viewportNumber}</span>
      </button>
    </CollapsibleTrigger>
  );
}

interface PixelInspectorRowListProps {
  activeSource: ViewportRightPanelActiveSource;
  snapshot: ViewportPixelReadoutSnapshot | null;
}

function PixelInspectorRowList(props: PixelInspectorRowListProps): JSX.Element {
  if (props.activeSource.imageSourceKind === "browser-source") {
    return <BrowserSourcePixelInspectorRow snapshot={props.snapshot} activeSource={props.activeSource} />;
  }
  if (!props.activeSource.raster) return <PixelInspectorEmptyState />;
  return (
    <RasterPixelInspectorRowList
      raster={props.activeSource.raster}
      activeSource={props.activeSource}
      snapshot={props.snapshot}
    />
  );
}

function PixelInspectorEmptyState(): JSX.Element {
  return (
    <p className="text-xs text-muted-foreground">
      Move the cursor over the image to inspect pixel values.
    </p>
  );
}

interface RasterPixelInspectorRowListProps {
  raster: RasterImage;
  activeSource: ViewportRightPanelActiveSource;
  snapshot: ViewportPixelReadoutSnapshot | null;
}

function RasterPixelInspectorRowList(props: RasterPixelInspectorRowListProps): JSX.Element {
  const rowValues = buildRasterRowsFromActiveSource(props.raster, props.activeSource, props.snapshot);
  const activeBandIndex = clampBandIndexToRaster(props.raster, props.activeSource.selectedBandIndex);
  return (
    <ul aria-label="Pixel values per band" className="flex flex-col gap-1">
      {rowValues.map((row) => (
        <li key={row.bandIndex}>
          <PixelInspectorRow row={row} isActive={row.bandIndex === activeBandIndex} />
        </li>
      ))}
    </ul>
  );
}

function buildRasterRowsFromActiveSource(
  raster: RasterImage,
  activeSource: ViewportRightPanelActiveSource,
  snapshot: ViewportPixelReadoutSnapshot | null,
): ReadonlyArray<PixelInspectorRowValues> {
  return buildRasterPixelInspectorRows({
    raster,
    perBandRawValueExtents: computePerBandRawValueExtentsForRaster(raster),
    cursorBandValues: readCursorBandValuesForActiveViewportOrNull(activeSource, snapshot),
    roiMeanBandValues: activeSource.activeRoiMeanSpectrum?.bandMeans ?? null,
  });
}

function readCursorBandValuesForActiveViewportOrNull(
  activeSource: ViewportRightPanelActiveSource,
  snapshot: ViewportPixelReadoutSnapshot | null,
): ReadonlyArray<number> | null {
  if (!snapshot || snapshot.viewportNumber !== activeSource.viewportNumber) return null;
  return snapshot.bands?.values ?? null;
}

interface BrowserSourcePixelInspectorRowProps {
  snapshot: ViewportPixelReadoutSnapshot | null;
  activeSource: ViewportRightPanelActiveSource;
}

function BrowserSourcePixelInspectorRow(
  props: BrowserSourcePixelInspectorRowProps,
): JSX.Element {
  const cursorBands = readCursorBandValuesForActiveViewportOrNull(
    props.activeSource,
    props.snapshot,
  );
  const row = buildBrowserSourcePixelInspectorRow(cursorBands);
  return (
    <ul aria-label="Pixel values" className="flex flex-col gap-1">
      <li>
        <PixelInspectorRow row={row} isActive={true} />
      </li>
    </ul>
  );
}

interface PixelInspectorRowProps {
  row: PixelInspectorRowValues;
  isActive: boolean;
}

function PixelInspectorRow(props: PixelInspectorRowProps): JSX.Element {
  return (
    <div className={getPixelInspectorRowClassName(props.isActive)}>
      <PixelInspectorRowLabel row={props.row} />
      <PixelInspectorRowDisplayValue text={props.row.displayValue} />
      <PixelInspectorRowMiniBar normalizedFraction={props.row.normalizedFraction} />
    </div>
  );
}

function getPixelInspectorRowClassName(isActive: boolean): string {
  return cn(
    "grid grid-cols-[1fr_auto_3rem] items-center gap-2 rounded-md px-2 py-1 text-sm",
    isActive ? "bg-accent" : "",
  );
}

function PixelInspectorRowLabel(props: { row: PixelInspectorRowValues }): JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {props.row.hasExplicitLabel ? (
        <BandIndexBadge originalNumber={props.row.originalNumber} />
      ) : null}
      <span className="truncate font-mono text-sm text-muted-foreground" title={props.row.label}>
        {props.row.label}
      </span>
    </span>
  );
}

function PixelInspectorRowDisplayValue(props: { text: string }): JSX.Element {
  return (
    <span className="text-right font-mono tabular-nums text-foreground" title={props.text}>
      {props.text}
    </span>
  );
}

interface PixelInspectorRowMiniBarProps {
  normalizedFraction: number | null;
}

function PixelInspectorRowMiniBar(props: PixelInspectorRowMiniBarProps): JSX.Element {
  const widthPercent =
    props.normalizedFraction === null ? 0 : Math.round(props.normalizedFraction * 100);
  return (
    <span
      aria-hidden="true"
      className="relative inline-block h-1 w-full rounded-full bg-muted"
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-primary"
        style={{ width: `${widthPercent}%` }}
      />
    </span>
  );
}
