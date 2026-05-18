import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs"],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default withSentryConfig(nextConfig, {
  // Suppress Sentry CLI output during builds
  silent: true,
  // Only upload source maps when SENTRY_AUTH_TOKEN is set (i.e., in CI/prod)
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Disable the Sentry telemetry
  telemetry: false,
});
