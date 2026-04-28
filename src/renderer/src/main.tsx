import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { applyDarkClassToDocumentRoot } from "@/lib/theme/apply-theme-class";
import "@/index.css";

function applyInitialThemeClassBeforeFirstPaint(): void {
  applyDarkClassToDocumentRoot(window.toolboxApi.initialTheme.isDark);
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Renderer root element with id 'root' not found");
}

applyInitialThemeClassBeforeFirstPaint();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
