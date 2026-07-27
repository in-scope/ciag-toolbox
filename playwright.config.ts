import { defineConfig } from "@playwright/test";

const ONE_MINUTE_IN_MS = 60_000;
const TEN_SECONDS_IN_MS = 10_000;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "test-results/playwright-report", open: "never" }],
  ],
  // Playwright clears outputDir at the start of every run, so it must NOT be
  // the test-results root: the archived per-run Electron traces live in
  // test-results/electron-traces/ and have to survive successive runs (CT-228).
  outputDir: "test-results/artifacts",
  timeout: ONE_MINUTE_IN_MS,
  expect: { timeout: TEN_SECONDS_IN_MS },
});
