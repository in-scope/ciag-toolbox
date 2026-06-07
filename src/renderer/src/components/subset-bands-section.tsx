import { useId, useMemo, useState } from "react";

import { BandIndexBadge } from "@/components/band-index-badge";
import { BandThumbnail } from "@/components/band-thumbnail";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  buildInitialKeptBandSetFromRemoved,
  listRemovedBandIndexesFromKeptSet,
  toggleBandIndexInKeptSet,
} from "@/lib/image/kept-band-set";
import {
  describeRasterBandDisplayIdentity,
  type RasterImage,
} from "@/lib/image/raster-image";
import { cn } from "@/lib/utils";

export interface SubsetBandsApplyOptions {
  readonly removedBandIndexes: ReadonlyArray<number>;
  readonly openInNewViewport: boolean;
}

export interface SubsetBandsSectionProps {
  readonly raster: RasterImage;
  readonly viewportNumber: number;
  readonly activeBandIndex: number;
  readonly initialRemovedBandIndexes: ReadonlyArray<number>;
  readonly onCancel: () => void;
  readonly onApply: (options: SubsetBandsApplyOptions) => void;
}

export function SubsetBandsSection(props: SubsetBandsSectionProps): JSX.Element {
  return (
    <section
      aria-label="Subset bands"
      className={SUBSET_BANDS_SECTION_CLASSES}
    >
      <SubsetBandsSectionHeader
        viewportNumber={props.viewportNumber}
        onCancel={props.onCancel}
      />
      <SubsetBandsSectionBody
        raster={props.raster}
        activeBandIndex={props.activeBandIndex}
        initialRemovedBandIndexes={props.initialRemovedBandIndexes}
        onApply={props.onApply}
        onCancel={props.onCancel}
      />
    </section>
  );
}

const SUBSET_BANDS_SECTION_CLASSES =
  "flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3";

interface SubsetBandsSectionHeaderProps {
  readonly viewportNumber: number;
  readonly onCancel: () => void;
}

function SubsetBandsSectionHeader(props: SubsetBandsSectionHeaderProps): JSX.Element {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-foreground">Subset Bands</h2>
        <span className="text-xs text-muted-foreground">Viewport {props.viewportNumber}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Choose which bands to keep. Apply to create a new image with just those bands.
      </p>
    </header>
  );
}

interface SubsetBandsSectionBodyProps {
  readonly raster: RasterImage;
  readonly activeBandIndex: number;
  readonly initialRemovedBandIndexes: ReadonlyArray<number>;
  readonly onApply: (options: SubsetBandsApplyOptions) => void;
  readonly onCancel: () => void;
}

function SubsetBandsSectionBody(props: SubsetBandsSectionBodyProps): JSX.Element {
  const [keptBandIndexes, setKeptBandIndexes] = useState<ReadonlySet<number>>(() =>
    buildInitialKeptBandSetFromRemoved(props.raster.bandCount, props.initialRemovedBandIndexes),
  );
  const [openInNewViewport, setOpenInNewViewport] = useState(true);
  const rowItems = useMemo(() => buildBandRowItemsForRaster(props.raster), [props.raster]);
  const onApply = () =>
    props.onApply(
      buildSubsetBandsApplyOptions(props.raster.bandCount, keptBandIndexes, openInNewViewport),
    );
  return (
    <>
      <SubsetBandsRowList
        raster={props.raster}
        rowItems={rowItems}
        keptBandIndexes={keptBandIndexes}
        activeBandIndex={props.activeBandIndex}
        onToggleKept={(bandIndex) => setKeptBandIndexes(toggleBandIndexInKeptSet(keptBandIndexes, bandIndex))}
      />
      <SubsetBandsApplyControls
        openInNewViewport={openInNewViewport}
        onChangeOpenInNewViewport={setOpenInNewViewport}
        disabledReason={describeApplyDisabledReasonForKeptSet(props.raster.bandCount, keptBandIndexes)}
        onCancel={props.onCancel}
        onApply={onApply}
      />
    </>
  );
}

function buildSubsetBandsApplyOptions(
  bandCount: number,
  keptBandIndexes: ReadonlySet<number>,
  openInNewViewport: boolean,
): SubsetBandsApplyOptions {
  return {
    removedBandIndexes: listRemovedBandIndexesFromKeptSet(bandCount, keptBandIndexes),
    openInNewViewport,
  };
}

interface SubsetBandsRowItem {
  readonly bandIndex: number;
  readonly label: string;
  readonly originalNumber: number;
  readonly hasExplicitLabel: boolean;
}

function buildBandRowItemsForRaster(raster: RasterImage): ReadonlyArray<SubsetBandsRowItem> {
  const items: SubsetBandsRowItem[] = [];
  for (let bandIndex = 0; bandIndex < raster.bandCount; bandIndex += 1) {
    items.push(buildSubsetBandsRowItem(raster, bandIndex));
  }
  return items;
}

function buildSubsetBandsRowItem(raster: RasterImage, bandIndex: number): SubsetBandsRowItem {
  const identity = describeRasterBandDisplayIdentity(raster, bandIndex);
  return {
    bandIndex,
    label: identity.label,
    originalNumber: identity.originalNumber,
    hasExplicitLabel: identity.hasExplicitLabel,
  };
}

interface SubsetBandsRowListProps {
  readonly raster: RasterImage;
  readonly rowItems: ReadonlyArray<SubsetBandsRowItem>;
  readonly keptBandIndexes: ReadonlySet<number>;
  readonly activeBandIndex: number;
  readonly onToggleKept: (bandIndex: number) => void;
}

function SubsetBandsRowList(props: SubsetBandsRowListProps): JSX.Element {
  return (
    <ul
      aria-label="Bands to keep"
      className="flex max-h-80 flex-col gap-1 overflow-y-auto"
    >
      {props.rowItems.map((item) => (
        <li key={item.bandIndex}>
          <SubsetBandsRow
            raster={props.raster}
            item={item}
            isKept={props.keptBandIndexes.has(item.bandIndex)}
            isActive={item.bandIndex === props.activeBandIndex}
            onToggleKept={() => props.onToggleKept(item.bandIndex)}
          />
        </li>
      ))}
    </ul>
  );
}

interface SubsetBandsRowProps {
  readonly raster: RasterImage;
  readonly item: SubsetBandsRowItem;
  readonly isKept: boolean;
  readonly isActive: boolean;
  readonly onToggleKept: () => void;
}

function SubsetBandsRow(props: SubsetBandsRowProps): JSX.Element {
  const checkboxId = useId();
  return (
    <label
      htmlFor={checkboxId}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
    >
      <Checkbox
        id={checkboxId}
        checked={props.isKept}
        aria-label={`Keep ${props.item.label}`}
        onCheckedChange={props.onToggleKept}
      />
      <BandThumbnail raster={props.raster} bandIndex={props.item.bandIndex} />
      {props.item.hasExplicitLabel ? (
        <BandIndexBadge originalNumber={props.item.originalNumber} />
      ) : null}
      <span className="flex-1 truncate text-sm" title={props.item.label}>
        {props.item.label}
      </span>
      {props.isActive ? <ActiveBandBadge /> : null}
    </label>
  );
}

function ActiveBandBadge(): JSX.Element {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary",
      )}
    >
      Active band
    </span>
  );
}

interface SubsetBandsApplyControlsProps {
  readonly openInNewViewport: boolean;
  readonly onChangeOpenInNewViewport: (next: boolean) => void;
  readonly disabledReason: string | null;
  readonly onCancel: () => void;
  readonly onApply: () => void;
}

function SubsetBandsApplyControls(props: SubsetBandsApplyControlsProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      <OpenInNewViewportSwitchRow
        checked={props.openInNewViewport}
        onCheckedChange={props.onChangeOpenInNewViewport}
      />
      <SubsetBandsButtonRow
        disabledReason={props.disabledReason}
        onCancel={props.onCancel}
        onApply={props.onApply}
      />
    </div>
  );
}

interface OpenInNewViewportSwitchRowProps {
  readonly checked: boolean;
  readonly onCheckedChange: (next: boolean) => void;
}

function OpenInNewViewportSwitchRow(props: OpenInNewViewportSwitchRowProps): JSX.Element {
  const id = "subset-bands-open-in-new-viewport";
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span>Open in a new viewport</span>
      <Switch id={id} checked={props.checked} onCheckedChange={props.onCheckedChange} />
    </label>
  );
}

interface SubsetBandsButtonRowProps {
  readonly disabledReason: string | null;
  readonly onCancel: () => void;
  readonly onApply: () => void;
}

function SubsetBandsButtonRow(props: SubsetBandsButtonRowProps): JSX.Element {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" size="sm" onClick={props.onCancel}>
        Cancel
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={props.disabledReason !== null}
        title={props.disabledReason ?? undefined}
        onClick={props.onApply}
      >
        Apply
      </Button>
    </div>
  );
}

function describeApplyDisabledReasonForKeptSet(
  bandCount: number,
  keptBandIndexes: ReadonlySet<number>,
): string | null {
  if (keptBandIndexes.size === 0) return "Keep at least one band";
  if (keptBandIndexes.size === bandCount) return "Uncheck a band to remove it on apply";
  return null;
}
