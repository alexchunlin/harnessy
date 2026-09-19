import { defineConfig } from "@playwright/test";

/**
 * Browser tests drive the real app against a copy of the RAMMP example and
 * assert on the files it writes and the CSV it downloads, not on the DOM.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:5199", headless: true },
  webServer: {
    command: "pnpm exec vite --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: false,
    env: { HARNESSY_HOME: process.env.HARNESSY_E2E_HOME ?? "/tmp/harnessy-e2e", VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
  },
});
