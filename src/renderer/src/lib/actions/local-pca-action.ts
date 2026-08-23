import { Focus } from "lucide-react";

import { registerLocalProjectionAction } from "./local-projection-action";
import type { RegisteredViewportAction } from "./registered-actions";

// CT-311: spatially adaptive PCA. One principal component is fitted on a rough
// grid of local box-kernel windows, the projectors are interpolated back onto
// every pixel, and the cube is projected onto them, so locally varying spectral
// structure survives where one global projection would average it away. The
// math is the client's own script, packaged as resources/builtin-python/
// local_pca.py and run through the Stage 5 worker; only the wiring is TS.

export const LOCAL_PCA_ACTION_ID = "local-pca";
export const LOCAL_PCA_LABEL = "Local PCA";

const LOCAL_PCA_COMPONENT_LABEL_PREFIX = "Local PC";

export const LOCAL_PCA_ACTION: RegisteredViewportAction = registerLocalProjectionAction({
  id: LOCAL_PCA_ACTION_ID,
  label: LOCAL_PCA_LABEL,
  icon: Focus,
  scriptName: "local_pca",
  componentLabelPrefix: LOCAL_PCA_COMPONENT_LABEL_PREFIX,
  successMessage: "Local PCA applied",
  loadingMessage: "Computing local principal components...",
});
