export interface ViewportRenderingState {
  readonly normalizationEnabled: boolean;
  readonly lastAppliedOperationLabel: string | null;
  readonly selectedBandIndex: number;
}

export const DEFAULT_VIEWPORT_RENDERING_STATE: ViewportRenderingState = {
  normalizationEnabled: false,
  lastAppliedOperationLabel: null,
  selectedBandIndex: 0,
};

export interface ViewportAction {
  readonly id: string;
  readonly label: string;
  readonly apply: (viewportState: ViewportRenderingState) => ViewportRenderingState;
}

export interface ApplyActionFailure {
  readonly viewportIndex: number;
  readonly error: unknown;
}

export interface ApplyActionCallbacks {
  readonly getViewportRenderingState: (viewportIndex: number) => ViewportRenderingState;
  readonly setViewportRenderingState: (viewportIndex: number, next: ViewportRenderingState) => void;
  readonly reportApplyFailure: (failure: ApplyActionFailure) => void;
}

export function applyActionToSelectedViewports(
  action: ViewportAction,
  selectedIndices: ReadonlySet<number>,
  callbacks: ApplyActionCallbacks,
): void {
  if (selectedIndices.size === 0) return;
  for (const viewportIndex of sortIndicesAscending(selectedIndices)) {
    applyActionToSingleViewport(action, viewportIndex, callbacks);
  }
}

function applyActionToSingleViewport(
  action: ViewportAction,
  viewportIndex: number,
  callbacks: ApplyActionCallbacks,
): void {
  try {
    const previous = callbacks.getViewportRenderingState(viewportIndex);
    const next = action.apply(previous);
    callbacks.setViewportRenderingState(viewportIndex, next);
  } catch (error) {
    callbacks.reportApplyFailure({ viewportIndex, error });
  }
}

function sortIndicesAscending(indices: ReadonlySet<number>): readonly number[] {
  return Array.from(indices).sort((a, b) => a - b);
}
