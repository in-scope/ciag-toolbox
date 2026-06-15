// CT-106: while a slow operation computes its result into a freshly opened
// result panel, that panel shows an immediate, operation-specific loading
// state. These pure helpers map an action to its loading message and decide
// whether a panel's busy indicator should paint immediately (a new, empty
// result panel) or after the usual anti-flash delay (an in-place op whose
// image is still visible underneath).

export interface OperationLoadingMessageSource {
  readonly label: string;
  readonly loadingMessage?: string;
}

export function describeOperationLoadingMessage(action: OperationLoadingMessageSource): string {
  return action.loadingMessage ?? `Applying ${action.label}...`;
}

export interface OperationLoadingPlacement {
  readonly opensInNewEmptyPanel: boolean;
}

export function shouldShowOperationLoadingImmediately(placement: OperationLoadingPlacement): boolean {
  return placement.opensInNewEmptyPanel;
}
