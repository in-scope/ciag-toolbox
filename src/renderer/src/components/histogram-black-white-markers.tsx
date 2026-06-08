import { useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  convertHistogramFractionToValue,
  convertValueToHistogramFraction,
  moveBlackWhitePointMarkerToValue,
  resolveBlackWhitePointSelectionWithinRange,
  type BlackWhitePointMarker,
  type BlackWhitePointSelection,
} from "@/lib/image/black-white-point-selection";
import { cn } from "@/lib/utils";

interface HistogramBlackWhiteMarkersProps {
  min: number;
  max: number;
  selection: BlackWhitePointSelection | null;
  onChange: (next: BlackWhitePointSelection) => void;
}

export function HistogramBlackWhiteMarkers(
  props: HistogramBlackWhiteMarkersProps,
): JSX.Element {
  const resolved = resolveBlackWhitePointSelectionWithinRange(props.selection, props.min, props.max);
  const drag = useBlackWhitePointMarkerDrag(props, resolved);
  return (
    <div
      className="absolute inset-0 touch-none"
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.endDrag}
      onPointerCancel={drag.endDrag}
    >
      <HistogramPointMarker
        marker="black"
        fraction={convertValueToHistogramFraction(resolved.black, props.min, props.max)}
        onPointerDown={drag.beginDrag("black")}
      />
      <HistogramPointMarker
        marker="white"
        fraction={convertValueToHistogramFraction(resolved.white, props.min, props.max)}
        onPointerDown={drag.beginDrag("white")}
      />
    </div>
  );
}

interface BlackWhitePointMarkerDrag {
  beginDrag: (marker: BlackWhitePointMarker) => (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  endDrag: () => void;
}

function useBlackWhitePointMarkerDrag(
  props: HistogramBlackWhiteMarkersProps,
  resolved: BlackWhitePointSelection,
): BlackWhitePointMarkerDrag {
  const [activeMarker, setActiveMarker] = useState<BlackWhitePointMarker | null>(null);
  return {
    beginDrag: (marker) => (event) => beginMarkerDrag(event, marker, setActiveMarker),
    onPointerMove: (event) => continueMarkerDrag(event, activeMarker, props, resolved),
    endDrag: () => setActiveMarker(null),
  };
}

function beginMarkerDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  marker: BlackWhitePointMarker,
  setActiveMarker: (next: BlackWhitePointMarker) => void,
): void {
  event.currentTarget.setPointerCapture?.(event.pointerId);
  setActiveMarker(marker);
}

function continueMarkerDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  activeMarker: BlackWhitePointMarker | null,
  props: HistogramBlackWhiteMarkersProps,
  resolved: BlackWhitePointSelection,
): void {
  if (!activeMarker) return;
  const fraction = computePointerFractionWithinElement(event.currentTarget, event.clientX);
  const value = convertHistogramFractionToValue(fraction, props.min, props.max);
  props.onChange(moveBlackWhitePointMarkerToValue(resolved, activeMarker, value, props.min, props.max));
}

function computePointerFractionWithinElement(element: HTMLElement, clientX: number): number {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return (clientX - rect.left) / rect.width;
}

interface HistogramPointMarkerProps {
  marker: BlackWhitePointMarker;
  fraction: number;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

function HistogramPointMarker(props: HistogramPointMarkerProps): JSX.Element {
  const isBlack = props.marker === "black";
  return (
    <div
      role="slider"
      aria-label={isBlack ? "Black point" : "White point"}
      aria-valuenow={Math.round(props.fraction * 100)}
      className="absolute bottom-0 top-0 -ml-1.5 w-3 cursor-ew-resize touch-none select-none"
      style={{ left: `${props.fraction * 100}%` }}
      onPointerDown={props.onPointerDown}
    >
      <span className={cn("absolute inset-y-0 left-1/2 w-px -translate-x-1/2", isBlack ? "bg-foreground" : "bg-primary")} />
      <span className={cn("absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-sm", isBlack ? "bg-foreground" : "bg-primary")} />
    </div>
  );
}
