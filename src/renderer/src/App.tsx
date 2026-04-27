import { useCallback, useEffect, useState } from "react";

import { AboutDialog } from "@/components/about-dialog";
import { Toolbar, type GridLayout } from "@/components/toolbar";
import { Viewport } from "@/components/viewport";

const DEFAULT_GRID_LAYOUT: GridLayout = "1x1";

export function App(): JSX.Element {
  const [gridLayout, setGridLayout] = useState<GridLayout>(DEFAULT_GRID_LAYOUT);
  const handleOpenImageRequested = useCallback(logOpenImageRequested, []);
  const handleApplyToSelected = useCallback(logApplyToSelected, []);
  useMenuOpenImageTriggersHandler(handleOpenImageRequested);
  return (
    <div className="flex h-full flex-col">
      <Toolbar
        onOpenImage={handleOpenImageRequested}
        gridLayout={gridLayout}
        onGridLayoutChange={setGridLayout}
        selectedViewportCount={0}
        onApplyToSelected={handleApplyToSelected}
      />
      <ApplicationStageContent />
      <AboutDialog />
    </div>
  );
}

function ApplicationStageContent(): JSX.Element {
  return (
    <main className="flex min-h-0 flex-1 p-4">
      <Viewport />
    </main>
  );
}

function useMenuOpenImageTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuOpenImage(handler), [handler]);
}

function logOpenImageRequested(): void {
  console.info("[toolbox] open image requested");
}

function logApplyToSelected(): void {
  console.info("[toolbox] apply to selected requested");
}
