import type { ViewportAction } from "./viewport-action";

export const TOGGLE_NORMALIZATION_ACTION: ViewportAction = {
  id: "toggle-normalization",
  label: "Toggle Normalization",
  apply: (state) => ({ ...state, normalizationEnabled: !state.normalizationEnabled }),
};

export const REGISTERED_VIEWPORT_ACTIONS: ReadonlyArray<ViewportAction> = [
  TOGGLE_NORMALIZATION_ACTION,
];
