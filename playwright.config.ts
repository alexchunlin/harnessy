import { defineConfig } from "@playwright/test";

/**
 * Browser tests drive the real app against a copy of the RAMMP example and
 * assert on the files it writes and the CSV it downloads, not on the DOM.
 */
const PORT = process.env.HARNESSY_E2E_PORT ?? "5199";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, headless: true },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    env: { HARNESSY_HOME: process.env.HARNESSY_E2E_HOME ?? "/tmp/harnessy-e2e", VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
  },
});
