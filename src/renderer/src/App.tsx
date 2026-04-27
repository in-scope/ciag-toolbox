import { Button } from "@/components/ui/button";
import { AboutDialog } from "@/components/about-dialog";

export function App(): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-start gap-4 p-6">
      <h1 className="text-2xl font-medium">MSI Toolbox v3</h1>
      <p className="text-muted-foreground">
        Stage 1 scaffold. Tailwind v4 + shadcn/ui are wired up.
      </p>
      <Button>Sample shadcn Button</Button>
      <AboutDialog />
    </main>
  );
}
