import { Waves } from "lucide-react";

import { applyMnf, fitMnf, noiseFractionPerComponent, type MnfFit } from "@/lib/image/dimension-reduction/mnf";

import { registerDimensionReductionAction } from "./dimension-reduction-action";
import type { RegisteredViewportAction } from "./registered-actions";

// CT-183: MNF is the second concrete dimension-reduction transform. It supplies
// only its math (fit/project) and a per-component noise-fraction readout; the
// CT-180 descriptor wires the component-count control, the float32 component
// stack, the audit-trail entry, and (via CT-182) the ROI fit scope. Each kept
// component's band label carries the fraction of its variance that is noise, so
// the strength readout flows through the band navigator and is serialized with
// the stack.

const MNF_COMPONENT_LABEL_PREFIX = "MNF";

export const MNF_ACTION: RegisteredViewportAction = registerDimensionReductionAction<MnfFit>({
  id: "mnf",
  label: "MNF",
  icon: Waves,
  successMessage: "MNF applied",
  loadingMessage: "Computing minimum-noise-fraction components...",
  componentLabelPrefix: MNF_COMPONENT_LABEL_PREFIX,
  fit: fitMnf,
  project: applyMnf,
  describeKeptComponentLabels: describeKeptMnfComponentLabels,
});

function describeKeptMnfComponentLabels(fit: MnfFit, keptCount: number): string[] {
  const noiseFractions = noiseFractionPerComponent(fit.eigenvalues);
  return Array.from({ length: keptCount }, (_unused, component) =>
    formatMnfComponentLabel(component, noiseFractions[component] ?? 1),
  );
}

function formatMnfComponentLabel(componentIndex: number, noiseFraction: number): string {
  const percent = (noiseFraction * 100).toFixed(1);
  return `${MNF_COMPONENT_LABEL_PREFIX} ${componentIndex + 1} (${percent}% noise)`;
}
