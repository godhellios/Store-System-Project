import { defineConfig } from "@playwright/test";

const VERCEL_PREVIEW = "https://mris-beryl.vercel.app";

export default defineConfig({
  testDir: "./tests/e2e",
  reporter: "list",
  use: {
    baseURL: VERCEL_PREVIEW,
    headless: true,
    screenshot: "only-on-failure",
  },
});
