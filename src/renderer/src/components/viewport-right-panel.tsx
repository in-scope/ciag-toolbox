import { useMemo, useId } from "react";

import {
  clampBandIndexToRaster,
  getRasterBandLabelOrDefault,
  type RasterImage,
} from "@/lib/image/raster-image";
import { cn } from "@/lib/utils";

export interface ViewportRightPanelActiveSource {
  readonly viewportNumber: number;
  readonly raster: RasterImage;
  readonly selectedBandIndex: number;
  readonly onSelectBandIndex: (bandIndex: number) => void;
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
  if (shouldShowBandsSection(activeSource)) {
    sections.push(<BandsSection key="bands" activeSource={activeSource!} />);
  }
  return sections;
}

function shouldShowBandsSection(
  activeSource: ViewportRightPanelActiveSource | null,
): boolean {
  if (!activeSource) return false;
  return activeSource.raster.bandCount > 1;
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

function BandsSection(props: BandsSectionProps): JSX.Element {
  const radioGroupName = useId();
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
