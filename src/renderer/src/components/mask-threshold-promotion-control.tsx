import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRasterBandIdentityText, type RasterImage } from "@/lib/image/raster-image";
import type { LoadedReferenceCandidate } from "@/lib/image/reference-token";
import { clampSelectedMaskCategoryIndex, type MaskBrushSettings } from "@/lib/masks/mask-brush";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import {
  filterLoadedReferenceCandidatesQualifyingForMaskPromotion,
  promoteThresholdBandToMaskCategory,
} from "@/lib/masks/mask-threshold-promotion";

// CT-305: fills the selected category from a Threshold result's white pixels.
// The source picker follows the CT-300 restricted raster-reference shape
// (open panels matching this stack's width/height), narrowed further to
// panels that are a plain two-level 8-bit stack; black pixels of the chosen
// band leave the layer's existing labels untouched.

export interface MaskThresholdPromotionControlProps {
  readonly layer: MaskLayer;
  readonly brush: MaskBrushSettings;
  readonly width: number;
  readonly height: number;
  readonly excludeToken: string | null;
  readonly loadedReferenceCandidates: ReadonlyArray<LoadedReferenceCandidate>;
  readonly onChangeLayer: (next: MaskLayer) => void;
}

const NO_QUALIFYING_SOURCE_HINT =
  "No open stack is a threshold result matching this stack's width and height. " +
  "Apply Threshold to a matching stack first.";

export function MaskThresholdPromotionControl(
  props: MaskThresholdPromotionControlProps,
): JSX.Element {
  const [sourceToken, setSourceToken] = useState<string | null>(null);
  const [bandIndex, setBandIndex] = useState(0);
  const candidates = filterLoadedReferenceCandidatesQualifyingForMaskPromotion(
    props.loadedReferenceCandidates,
    props.width,
    props.height,
    props.excludeToken ?? undefined,
  );
  const source = candidates.find((candidate) => candidate.token === sourceToken) ?? null;

  return (
    <section aria-label="Promote threshold result" className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">From threshold result</span>
      {candidates.length === 0 ? (
        <span className="text-xs text-muted-foreground">{NO_QUALIFYING_SOURCE_HINT}</span>
      ) : (
        <>
          <SourcePanelMenu
            candidates={candidates}
            selectedLabel={source?.label ?? null}
            onSelect={(token) => selectSourcePanel(token, setSourceToken, setBandIndex)}
          />
          {source ? (
            <BandMenu raster={source.raster} bandIndex={bandIndex} onSelect={setBandIndex} />
          ) : null}
          <PromoteButton
            layer={props.layer}
            brush={props.brush}
            source={source}
            bandIndex={bandIndex}
            onChangeLayer={props.onChangeLayer}
          />
        </>
      )}
    </section>
  );
}

function selectSourcePanel(
  token: string,
  setSourceToken: (token: string) => void,
  setBandIndex: (index: number) => void,
): void {
  setSourceToken(token);
  setBandIndex(0);
}

interface SourcePanelMenuProps {
  readonly candidates: ReadonlyArray<LoadedReferenceCandidate>;
  readonly selectedLabel: string | null;
  readonly onSelect: (token: string) => void;
}

function SourcePanelMenu(props: SourcePanelMenuProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label="Source panel" className="justify-start">
          {props.selectedLabel ?? "Choose source panel..."}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {props.candidates.map((candidate) => (
          <DropdownMenuItem key={candidate.token} onSelect={() => props.onSelect(candidate.token)}>
            {candidate.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface BandMenuProps {
  readonly raster: RasterImage;
  readonly bandIndex: number;
  readonly onSelect: (index: number) => void;
}

function BandMenu(props: BandMenuProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label="Source band" className="justify-start">
          {formatRasterBandIdentityText(props.raster, props.bandIndex)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {props.raster.bandPixels.map((_, index) => (
          <DropdownMenuItem key={index} onSelect={() => props.onSelect(index)}>
            {formatRasterBandIdentityText(props.raster, index)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface PromoteButtonProps {
  readonly layer: MaskLayer;
  readonly brush: MaskBrushSettings;
  readonly source: LoadedReferenceCandidate | null;
  readonly bandIndex: number;
  readonly onChangeLayer: (next: MaskLayer) => void;
}

function PromoteButton(props: PromoteButtonProps): JSX.Element {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={props.source === null}
      onClick={() => props.source && promote(props)}
    >
      Promote to {describeSelectedCategoryName(props.layer, props.brush)}
    </Button>
  );
}

function describeSelectedCategoryName(layer: MaskLayer, brush: MaskBrushSettings): string {
  const categoryValue = clampSelectedMaskCategoryIndex(brush.selectedCategoryIndex, layer.categories.length);
  return layer.categories[categoryValue - 1]?.name ?? "category";
}

function promote(props: PromoteButtonProps): void {
  const bandPixels = props.source?.raster.bandPixels[props.bandIndex];
  if (!bandPixels) return;
  props.onChangeLayer(
    promoteThresholdBandToMaskCategory(props.layer, bandPixels, props.brush.selectedCategoryIndex),
  );
}
