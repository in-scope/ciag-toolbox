import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const RENDERER_SRC_DIR = fileURLToPath(new URL("./src/renderer/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": RENDERER_SRC_DIR,
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
