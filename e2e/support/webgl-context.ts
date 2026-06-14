import type { Page } from "@playwright/test";

// Introspects and perturbs the viewport canvas's live WebGL context from inside
// the renderer (manual test script section 5). The viewport canvas carries only
// aria-label="Panel N" (no role), so it is selected by tag + aria-label, the same
// convention as panels.ts. getContext("webgl2") returns the EXISTING context the
// renderer already created, so reading it here does not allocate a second one.

function panelCanvasSelector(panelNumber: number): string {
  return `canvas[aria-label="Panel ${panelNumber}"]`;
}

export async function readPanelCanvasWebglContextName(
  page: Page,
  panelNumber: number,
): Promise<string | null> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector);
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    return gl ? gl.constructor.name : null;
  }, panelCanvasSelector(panelNumber));
}

export async function forcePanelCanvasContextLoss(
  page: Page,
  panelNumber: number,
): Promise<void> {
  await page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
    const gl = canvas?.getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }, panelCanvasSelector(panelNumber));
}

export async function restorePanelCanvasContext(
  page: Page,
  panelNumber: number,
): Promise<void> {
  await page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
    const gl = canvas?.getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.restoreContext();
  }, panelCanvasSelector(panelNumber));
}
