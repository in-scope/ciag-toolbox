import type { ComponentType, SVGProps } from "react";
import { Contrast } from "lucide-react";

import type { ViewportAction } from "./viewport-action";

export type RegisteredActionIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface RegisteredViewportAction extends ViewportAction {
  readonly icon: RegisteredActionIcon;
  readonly successMessage: string;
  readonly appliedLabel: string;
}

export const NORMALIZE_ACTION: RegisteredViewportAction = {
  id: "normalize",
  label: "Normalize",
  icon: Contrast,
  successMessage: "Normalization applied",
  appliedLabel: "Normalized",
  apply: (state) => ({ ...state, normalizationEnabled: true }),
};

export const REGISTERED_VIEWPORT_ACTIONS: ReadonlyArray<RegisteredViewportAction> = [
  NORMALIZE_ACTION,
];
