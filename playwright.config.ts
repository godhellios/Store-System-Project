import { defineConfig, devices } from "@playwright/test";

const VERCEL_PREVIEW = "https://mris-beryl.vercel.app";

export default defineConfig({
  testDir: "./tests/e2e",
  reporter: "list",
  use: {
    baseURL: VERCEL_PREVIEW,
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 13"] },
    },
  ],
});
