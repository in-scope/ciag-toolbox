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
      className="toaster group"
      toastOptions={{
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
