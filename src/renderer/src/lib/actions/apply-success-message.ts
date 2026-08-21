// CT-276: the success toast for an apply whose result opened in a NEW panel
// may carry an extra hint sentence (e.g. Crop's "Closing the original panel
// frees its memory."). An in-place apply, or an action without a hint, toasts
// the plain success message.

export interface ApplySuccessMessageSource {
  readonly successMessage: string;
  readonly successHintWhenResultOpensNewPanel?: string;
}

export function composeApplySuccessMessage(
  action: ApplySuccessMessageSource,
  resultOpenedInNewPanel: boolean,
): string {
  const hint = action.successHintWhenResultOpensNewPanel;
  if (!resultOpenedInNewPanel || !hint) return action.successMessage;
  return `${action.successMessage}. ${hint}`;
}
