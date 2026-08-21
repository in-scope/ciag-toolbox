import { useId, useMemo, useState } from "react";

import { BandIndexBadge } from "@/components/band-index-badge";
import { BandSelectionFunctionEditor } from "@/components/band-selection-function-editor";
import { BandThumbnail } from "@/components/band-thumbnail";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { OpenInNewPanelSwitchRow } from "@/components/open-in-new-panel-switch-row";
import {
  buildInitialKeptBandSetFromRemoved,
  listRemovedBandIndexesFromKeptSet,
  toggleBandIndexInKeptSet,
} from "@/lib/image/kept-band-set";
import {
  BAND_RANGE_FIELD_SYNTAX_HINT,
  BAND_RANGE_SYNTAX_EXAMPLES,
} from "@/lib/image/parse-band-range";
import {
  deriveKeptBandSelectionFromTypedRangeText,
  describeTypedRangeFieldErrorOrNull,
} from "@/lib/image/subset-band-range-field";
import {
  describeRasterBandDisplayIdentity,
  type RasterImage,
} from "@/lib/image/raster-image";
import { cn } from "@/lib/utils";

export interface SubsetBandsApplyOptions {
  readonly removedBandIndexes: ReadonlyArray<number>;
  readonly openInNewViewport: boolean;
}

export interface SubsetBandsFunctionApplyOptions {
  readonly openInNewViewport: boolean;
}

// CT-284: the editor's two ways to make a band tool of the stack. "Keep bands"
// is the CT-091 index selection; "By function" houses the former Band Selection
// capabilities (presets, formula, imported tool) and applies through that action.
export type SubsetBandsEditorMode = "keep-bands" | "by-function";

export interface SubsetBandsSectionProps {
  readonly raster: RasterImage;
  readonly viewportIndex: number;
  readonly viewportNumber: number;
  readonly activeBandIndex: number;
  readonly initialRemovedBandIndexes: ReadonlyArray<number>;
  readonly onCancel: () => void;
  readonly onApply: (options: SubsetBandsApplyOptions) => void;
  readonly onApplyFunctionDerivedBand: (options: SubsetBandsFunctionApplyOptions) => void;
}

export function SubsetBandsSection(props: SubsetBandsSectionProps): JSX.Element {
  const [mode, setMode] = useState<SubsetBandsEditorMode>("keep-bands");
  return (
    <section
      aria-label="Subset bands"
      className={SUBSET_BANDS_SECTION_CLASSES}
    >
      <SubsetBandsSectionHeader viewportNumber={props.viewportNumber} mode={mode} />
      <SubsetBandsModeSelect mode={mode} onChangeMode={setMode} />
      {mode === "keep-bands" ? (
        <SubsetBandsKeepBandsBody
          raster={props.raster}
          activeBandIndex={props.activeBandIndex}
          initialRemovedBandIndexes={props.initialRemovedBandIndexes}
          onApply={props.onApply}
          onCancel={props.onCancel}
        />
      ) : (
        <SubsetBandsByFunctionBody
          raster={props.raster}
          viewportIndex={props.viewportIndex}
          onApply={props.onApplyFunctionDerivedBand}
          onCancel={props.onCancel}
        />
      )}
    </section>
  );
}

const SUBSET_BANDS_SECTION_CLASSES =
  "flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3";

interface SubsetBandsSectionHeaderProps {
  readonly viewportNumber: number;
  readonly mode: SubsetBandsEditorMode;
}

const MODE_DESCRIPTIONS: Record<SubsetBandsEditorMode, string> = {
  "keep-bands": "Choose which bands to keep. Apply to create a new stack with just those bands.",
  "by-function": "Derive one band from the whole stack with a function.",
};

function SubsetBandsSectionHeader(props: SubsetBandsSectionHeaderProps): JSX.Element {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-foreground">Subset Bands</h2>
        <span className="text-xs text-muted-foreground">Panel {props.viewportNumber}</span>
      </div>
      <p className="text-xs text-muted-foreground">{MODE_DESCRIPTIONS[props.mode]}</p>
    </header>
  );
}

interface SubsetBandsModeSelectProps {
  readonly mode: SubsetBandsEditorMode;
  readonly onChangeMode: (nextMode: SubsetBandsEditorMode) => void;
}

function SubsetBandsModeSelect(props: SubsetBandsModeSelectProps): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">Mode</span>
      <select
        id={id}
        value={props.mode}
        onChange={(event) => props.onChangeMode(event.target.value as SubsetBandsEditorMode)}
        className={MODE_SELECT_CLASSES}
      >
        <option value="keep-bands">Keep bands</option>
        <option value="by-function">By function</option>
      </select>
    </label>
  );
}

const MODE_SELECT_CLASSES =
  "h-8 rounded-md border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

interface SubsetBandsKeepBandsBodyProps {
  readonly raster: RasterImage;
  readonly activeBandIndex: number;
  readonly initialRemovedBandIndexes: ReadonlyArray<number>;
  readonly onApply: (options: SubsetBandsApplyOptions) => void;
  readonly onCancel: () => void;
}

function SubsetBandsKeepBandsBody(props: SubsetBandsKeepBandsBodyProps): JSX.Element {
  const selection = useKeptBandSelectionDrivenByTypedRange(
    props.raster.bandCount,
    props.initialRemovedBandIndexes,
  );
  const [openInNewViewport, setOpenInNewViewport] = useState(true);
  const rowItems = useMemo(() => buildBandRowItemsForRaster(props.raster), [props.raster]);
  const onApply = () =>
    props.onApply(
      buildSubsetBandsApplyOptions(props.raster.bandCount, selection.keptBandIndexes, openInNewViewport),
    );
  return (
    <>
      <SubsetBandsTypedRangeField
        value={selection.typedRangeText}
        error={describeTypedRangeFieldErrorOrNull(selection.typedRangeText, props.raster.bandCount)}
        onChangeValue={selection.onChangeTypedRangeText}
      />
      <SubsetBandsRowList
        raster={props.raster}
        rowItems={rowItems}
        keptBandIndexes={selection.keptBandIndexes}
        activeBandIndex={props.activeBandIndex}
        onToggleKept={selection.onToggleKeptBand}
      />
      <SubsetBandsApplyControls
        openInNewViewport={openInNewViewport}
        onChangeOpenInNewViewport={setOpenInNewViewport}
        disabledReason={describeApplyDisabledReasonForKeptSet(props.raster.bandCount, selection.keptBandIndexes)}
        onCancel={props.onCancel}
        onApply={onApply}
      />
    </>
  );
}

interface SubsetBandsByFunctionBodyProps {
  readonly raster: RasterImage;
  readonly viewportIndex: number;
  readonly onApply: (options: SubsetBandsFunctionApplyOptions) => void;
  readonly onCancel: () => void;
}

function SubsetBandsByFunctionBody(props: SubsetBandsByFunctionBodyProps): JSX.Element {
  const [openInNewViewport, setOpenInNewViewport] = useState(true);
  return (
    <>
      <BandSelectionFunctionEditor viewportIndex={props.viewportIndex} raster={props.raster} />
      <SubsetBandsApplyControls
        openInNewViewport={openInNewViewport}
        onChangeOpenInNewViewport={setOpenInNewViewport}
        disabledReason={null}
        onCancel={props.onCancel}
        onApply={() => props.onApply({ openInNewViewport })}
      />
    </>
  );
}

interface KeptBandSelectionDrivenByTypedRange {
  readonly keptBandIndexes: ReadonlySet<number>;
  readonly typedRangeText: string;
  readonly onChangeTypedRangeText: (nextText: string) => void;
  readonly onToggleKeptBand: (bandIndex: number) => void;
}

// A valid typed expression REPLACES the checkbox selection; invalid or empty text
// changes nothing. Checkbox toggles never rewrite the typed text (CT-283).
function useKeptBandSelectionDrivenByTypedRange(
  bandCount: number,
  initialRemovedBandIndexes: ReadonlyArray<number>,
): KeptBandSelectionDrivenByTypedRange {
  const [keptBandIndexes, setKeptBandIndexes] = useState<ReadonlySet<number>>(() =>
    buildInitialKeptBandSetFromRemoved(bandCount, initialRemovedBandIndexes),
  );
  const [typedRangeText, setTypedRangeText] = useState("");
  const onChangeTypedRangeText = (nextText: string) => {
    setTypedRangeText(nextText);
    const outcome = deriveKeptBandSelectionFromTypedRangeText(nextText, bandCount);
    if (outcome.kind === "selection") setKeptBandIndexes(outcome.keptBandIndexes);
  };
  const onToggleKeptBand = (bandIndex: number) =>
    setKeptBandIndexes(toggleBandIndexInKeptSet(keptBandIndexes, bandIndex));
  return { keptBandIndexes, typedRangeText, onChangeTypedRangeText, onToggleKeptBand };
}

interface SubsetBandsTypedRangeFieldProps {
  readonly value: string;
  readonly error: string | null;
  readonly onChangeValue: (nextText: string) => void;
}

function SubsetBandsTypedRangeField(props: SubsetBandsTypedRangeFieldProps): JSX.Element {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <Input
        id={inputId}
        type="text"
        value={props.value}
        placeholder={BAND_RANGE_SYNTAX_EXAMPLES}
        aria-label="Bands to keep"
        aria-describedby={hintId}
        aria-invalid={props.error !== null}
        onChange={(event) => props.onChangeValue(event.target.value)}
        className={cn("h-8", props.error !== null && "border-destructive focus-visible:ring-destructive")}
      />
      <span id={hintId} className="text-xs text-muted-foreground">
        {BAND_RANGE_FIELD_SYNTAX_HINT}
      </span>
      {props.error !== null ? <span className="text-xs text-destructive">{props.error}</span> : null}
    </div>
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
      <OpenInNewPanelSwitchRow
        switchId="subset-bands-open-in-new-viewport"
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
