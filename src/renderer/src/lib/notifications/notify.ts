import { toast } from "sonner";

import { buildErrorToastOptions, buildSuccessToastOptions } from "./toast-options";

// The one place error and success toasts are raised, so every error toast
// carries the CT-260 persistence options. Info toasts stay on toast.info
// directly (transient by design, no variant options).

export function notifyError(message: string): void {
  toast.error(message, buildErrorToastOptions());
}

export function notifySuccess(message: string): void {
  toast.success(message, buildSuccessToastOptions());
}
