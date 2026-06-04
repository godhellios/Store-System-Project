import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright e2e specs live under tests/e2e and use the Playwright runner,
    // not vitest — exclude them so `vitest run` only collects unit tests.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
