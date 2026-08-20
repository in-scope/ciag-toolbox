import type { CSSProperties } from "react";

// CT-260: an error toast (often a memory refusal telling the user which panels
// to close) must wait to be read: it never auto-dismisses and carries its own
// close button. The Toaster makes every toast pointer-transparent by default
// (components/ui/sonner.tsx) so transient toasts cannot block the panel under
// them; an error toast opts back in to pointer events per-toast, because its
// close button has to be hoverable and clickable. Success and info toasts keep
// the transient auto-dismissing defaults.

export interface ToastVariantOptions {
  readonly duration?: number;
  readonly closeButton?: boolean;
  readonly style?: CSSProperties;
}

export function buildErrorToastOptions(): ToastVariantOptions {
  return {
    duration: Number.POSITIVE_INFINITY,
    closeButton: true,
    style: { pointerEvents: "auto" },
  };
}

export function buildSuccessToastOptions(): ToastVariantOptions {
  return {};
}
