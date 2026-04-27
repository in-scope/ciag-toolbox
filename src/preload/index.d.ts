import type { ToolboxApi } from "./index";

declare global {
  interface Window {
    toolboxApi: ToolboxApi;
  }
}

export {};
