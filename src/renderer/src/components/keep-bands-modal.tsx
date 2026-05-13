import { useId, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  buildInitialKeptBandSetFromRemoved,
  listRemovedBandIndexesFromKeptSet,
  toggleBandIndexInKeptSet,
} from "@/lib/image/kept-band-set";
import {
  getRasterBandLabelOrDefault,
  type RasterImage,
} from "@/lib/image/raster-image";
import { cn } from "@/lib/utils";

import { BandThumbnail } from "./band-thumbnail";

export interface KeepBandsModalProps {
  readonly isOpen: boolean;
  readonly raster: RasterImage | null;
  readonly initialRemovedBandIndexes: ReadonlyArray<number>;
  readonly activeBandIndex: number;
  readonly onCancel: () => void;
  readonly onConfirm: (removedBandIndexes: ReadonlyArray<number>) => void;
}

export function KeepBandsModal(props: KeepBandsModalProps): JSX.Element {
  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => dismissModalWhenClosed(open, props.onCancel)}
    >
      <DialogContent className="max-w-md">
        {props.isOpen && props.raster ? (
          <KeepBandsModalBody
            raster={props.raster}
            initialRemovedBandIndexes={props.initialRemovedBandIndexes}
            activeBandIndex={props.activeBandIndex}
            onCancel={props.onCancel}
            onConfirm={props.onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function dismissModalWhenClosed(open: boolean, onCancel: () => void): void {
  if (!open) onCancel();
}

interface KeepBandsModalBodyProps {
  readonly raster: RasterImage;
  readonly initialRemovedBandIndexes: ReadonlyArray<number>;
  readonly activeBandIndex: number;
  readonly onCancel: () => void;
  readonly onConfirm: (removedBandIndexes: ReadonlyArray<number>) => void;
}

function KeepBandsModalBody(props: KeepBandsModalBodyProps): JSX.Element {
  const [keptBandIndexes, setKeptBandIndexes] = useState<ReadonlySet<number>>(() =>
    buildInitialKeptBandSetFromRemoved(
      props.raster.bandCount,
      props.initialRemovedBandIndexes,
    ),
  );
  const rowItems = useMemo(() => buildBandRowItemsForRaster(props.raster), [props.raster]);
  const disabledReason = describeConfirmDisabledReasonForKeptSet(
    props.raster.bandCount,
    keptBandIndexes,
  );
  return (
    <>
      <KeepBandsModalHeader />
      <KeepBandsRowList
        raster={props.raster}
        rowItems={rowItems}
        keptBandIndexes={keptBandIndexes}
        activeBandIndex={props.activeBandIndex}
        onToggleKept={(bandIndex) =>
          setKeptBandIndexes((prev) => toggleBandIndexInKeptSet(prev, bandIndex))
        }
      />
      <KeepBandsModalFooter
        disabledReason={disabledReason}
        onCancel={props.onCancel}
        onConfirm={() =>
          props.onConfirm(
            listRemovedBandIndexesFromKeptSet(props.raster.bandCount, keptBandIndexes),
          )
        }
      />
    </>
  );
}

function KeepBandsModalHeader(): JSX.Element {
  return (
    <DialogHeader>
      <DialogTitle>Keep Bands</DialogTitle>
      <DialogDescription>
        Choose which bands to keep. A new viewport opens with only the kept bands.
      </DialogDescription>
    </DialogHeader>
  );
}

interface KeepBandsRowItem {
  readonly bandIndex: number;
  readonly label: string;
}

function buildBandRowItemsForRaster(raster: RasterImage): ReadonlyArray<KeepBandsRowItem> {
  const items: KeepBandsRowItem[] = [];
  for (let bandIndex = 0; bandIndex < raster.bandCount; bandIndex += 1) {
    items.push({ bandIndex, label: getRasterBandLabelOrDefault(raster, bandIndex) });
  }
  return items;
}

interface KeepBandsRowListProps {
  readonly raster: RasterImage;
  readonly rowItems: ReadonlyArray<KeepBandsRowItem>;
  readonly keptBandIndexes: ReadonlySet<number>;
  readonly activeBandIndex: number;
  readonly onToggleKept: (bandIndex: number) => void;
}

function KeepBandsRowList(props: KeepBandsRowListProps): JSX.Element {
  return (
    <ul
      aria-label="Bands to keep"
      className="flex max-h-80 flex-col gap-1 overflow-y-auto"
    >
      {props.rowItems.map((item) => (
        <li key={item.bandIndex}>
          <KeepBandsRow
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

interface KeepBandsRowProps {
  readonly raster: RasterImage;
  readonly item: KeepBandsRowItem;
  readonly isKept: boolean;
  readonly isActive: boolean;
  readonly onToggleKept: () => void;
}

function KeepBandsRow(props: KeepBandsRowProps): JSX.Element {
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

interface KeepBandsModalFooterProps {
  readonly disabledReason: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function KeepBandsModalFooter(props: KeepBandsModalFooterProps): JSX.Element {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={props.onCancel}>
        Cancel
      </Button>
      <Button
        type="button"
        disabled={props.disabledReason !== null}
        title={props.disabledReason ?? undefined}
        onClick={props.onConfirm}
      >
        Confirm
      </Button>
    </DialogFooter>
  );
}

function describeConfirmDisabledReasonForKeptSet(
  bandCount: number,
  keptBandIndexes: ReadonlySet<number>,
): string | null {
  if (keptBandIndexes.size === 0) return "Keep at least one band";
  if (keptBandIndexes.size === bandCount) return "Uncheck a band to remove it on apply";
  return null;
}
