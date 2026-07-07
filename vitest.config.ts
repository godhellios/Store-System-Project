import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Resolve the "@/..." path alias (matches tsconfig) so tests can import route
  // handlers and other modules that use it, not just relative-imported libs.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Playwright e2e specs live under tests/e2e and use the Playwright runner,
    // not vitest — exclude them so `vitest run` only collects unit tests.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
