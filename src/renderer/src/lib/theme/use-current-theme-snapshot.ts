import { useEffect, useState } from "react";

export function useCurrentThemeSnapshot(): ToolboxThemeSnapshot {
  const [snapshot, setSnapshot] = useState<ToolboxThemeSnapshot>(
    () => window.toolboxApi.initialTheme,
  );
  useEffect(() => window.toolboxApi.onThemeChange(setSnapshot), []);
  return snapshot;
}
