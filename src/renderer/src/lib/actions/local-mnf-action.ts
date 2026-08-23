import { Filter } from "lucide-react";

import { registerLocalProjectionAction } from "./local-projection-action";
import type { RegisteredViewportAction } from "./registered-actions";

// CT-312: spatially adaptive MNF, the same shared wiring as Local PCA
// (CT-311) around the client's local_mnf.py, which shares localPCA's exact
// run(cube, wavelengths, params) signature.

export const LOCAL_MNF_ACTION_ID = "local-mnf";
export const LOCAL_MNF_LABEL = "Local MNF";

const LOCAL_MNF_COMPONENT_LABEL_PREFIX = "Local MNF";

export const LOCAL_MNF_ACTION: RegisteredViewportAction = registerLocalProjectionAction({
  id: LOCAL_MNF_ACTION_ID,
  label: LOCAL_MNF_LABEL,
  icon: Filter,
  scriptName: "local_mnf",
  componentLabelPrefix: LOCAL_MNF_COMPONENT_LABEL_PREFIX,
  successMessage: "Local MNF applied",
  loadingMessage: "Computing local noise fraction components...",
});
