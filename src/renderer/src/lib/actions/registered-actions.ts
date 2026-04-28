import type { ComponentType, SVGProps } from "react";
import { Contrast } from "lucide-react";

import type { ViewportAction } from "./viewport-action";

export type RegisteredActionIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface RegisteredViewportAction extends ViewportAction {
  readonly icon: RegisteredActionIcon;
}

export const TOGGLE_NORMALIZATION_ACTION: RegisteredViewportAction = {
  id: "toggle-normalization",
  label: "Toggle Normalization",
  icon: Contrast,
  apply: (state) => ({ ...state, normalizationEnabled: !state.normalizationEnabled }),
};

export const REGISTERED_VIEWPORT_ACTIONS: ReadonlyArray<RegisteredViewportAction> = [
  TOGGLE_NORMALIZATION_ACTION,
];
