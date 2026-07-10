import { app } from "electron";

// CT-219b: a renderer killed by the OS or by an out-of-memory condition dies
// with no error surface at all (the window just goes blank). Logging the
// render-process-gone details from the main process is the only reliable
// evidence of WHY the renderer died, so failures like "opening a very large
// stack kills the app" are diagnosable from the terminal or a wrapped log.
export function registerRendererCrashLogging(): void {
  app.on("render-process-gone", (_event, webContents, details) => {
    console.error(
      `[renderer-crash] render-process-gone url=${webContents.getURL()} reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });
  app.on("child-process-gone", (_event, details) => {
    logNonRendererChildProcessGone(details);
  });
}

function logNonRendererChildProcessGone(details: Electron.Details): void {
  if (details.reason === "clean-exit") return;
  console.error(
    `[renderer-crash] child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
  );
}
