import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import { useCurrentThemeSnapshot } from "@/lib/theme/use-current-theme-snapshot";

function selectSonnerThemeFromSnapshot(
  snapshot: ToolboxThemeSnapshot,
): ToasterProps["theme"] {
  return snapshot.isDark ? "dark" : "light";
}

function Toaster(props: ToasterProps): JSX.Element {
  const snapshot = useCurrentThemeSnapshot();
  return (
    <SonnerToaster
      theme={selectSonnerThemeFromSnapshot(snapshot)}
      position="bottom-left"
      className="toaster group"
      toastOptions={{
        // Transient notifications are purely informational: they must never trap
        // pointer input or sit on top of the panel beneath them. Making each toast
        // pointer-transparent lets a hover pass through to the canvas/readout (and
        // stops a hover from pausing auto-dismiss), so a toast over the lowest panel
        // can no longer block reading a pixel value underneath it.
        style: { pointerEvents: "none" },
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
