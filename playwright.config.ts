import { defineConfig } from "@playwright/test";

const ONE_MINUTE_IN_MS = 60_000;
const TEN_SECONDS_IN_MS = 10_000;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: ONE_MINUTE_IN_MS,
  expect: { timeout: TEN_SECONDS_IN_MS },
});
