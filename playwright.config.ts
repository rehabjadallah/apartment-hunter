import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 240_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5173", channel: "chrome", screenshot: "only-on-failure" },
});
