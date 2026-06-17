import { Split } from "lucide-react";

import { applyIca, fitIca, type IcaFit } from "@/lib/image/dimension-reduction/ica";

import { registerDimensionReductionAction } from "./dimension-reduction-action";
import type { RegisteredViewportAction } from "./registered-actions";

// CT-184: ICA is the third concrete dimension-reduction transform. It supplies
// only its math (fit/project); the CT-180 descriptor wires the component-count
// control, the float32 component-stack output, the audit-trail entry, and (via
// CT-182) the ROI fit scope. ICA reports NO per-component strength metric (none
// is standard for independent components), so it omits describeKeptComponentLabels
// and the kept bands fall back to the default "IC N" labels.

const ICA_COMPONENT_LABEL_PREFIX = "IC";

export const ICA_ACTION: RegisteredViewportAction = registerDimensionReductionAction<IcaFit>({
  id: "ica",
  label: "ICA",
  icon: Split,
  successMessage: "ICA applied",
  loadingMessage: "Computing independent components...",
  componentLabelPrefix: ICA_COMPONENT_LABEL_PREFIX,
  fit: fitIca,
  project: applyIca,
});
