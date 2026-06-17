import { Component } from "lucide-react";

import { applyPca, fitPca, varianceExplained, type PcaFit } from "@/lib/image/dimension-reduction/pca";

import { registerDimensionReductionAction } from "./dimension-reduction-action";
import type { RegisteredViewportAction } from "./registered-actions";

// CT-181: PCA is the first concrete dimension-reduction transform. It supplies
// only its math (fit/project) and a per-component variance readout; the CT-180
// descriptor wires the component-count control, the float32 component-stack
// output, and the audit-trail entry. Each kept component's band label carries
// the percentage of total variance it explains so the strength readout flows
// through the band navigator and is serialized with the stack.

const PCA_COMPONENT_LABEL_PREFIX = "PC";

export const PCA_ACTION: RegisteredViewportAction = registerDimensionReductionAction<PcaFit>({
  id: "pca",
  label: "PCA",
  icon: Component,
  successMessage: "PCA applied",
  loadingMessage: "Computing principal components...",
  componentLabelPrefix: PCA_COMPONENT_LABEL_PREFIX,
  fit: fitPca,
  project: applyPca,
  describeKeptComponentLabels: describeKeptPrincipalComponentLabels,
});

function describeKeptPrincipalComponentLabels(fit: PcaFit, keptCount: number): string[] {
  const variancePerComponent = varianceExplained(fit.eigenvalues);
  return Array.from({ length: keptCount }, (_unused, component) =>
    formatPrincipalComponentLabel(component, variancePerComponent[component] ?? 0),
  );
}

function formatPrincipalComponentLabel(componentIndex: number, varianceFraction: number): string {
  const percent = (varianceFraction * 100).toFixed(1);
  return `${PCA_COMPONENT_LABEL_PREFIX} ${componentIndex + 1} (${percent}% var)`;
}
