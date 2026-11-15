import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against a dev server wired to the reference backend
 * (tools/reference-backend/server.mjs). Requires prepared media
 * (npm run media:prepare). Run: npm run test:e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 3200);
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 3299);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    {
      command: `node tools/reference-backend/server.mjs --port ${BACKEND_PORT}`,
      url: `http://127.0.0.1:${BACKEND_PORT}/v1/health`,
      reuseExistingServer: true,
    },
    {
      command: `npx next dev -p ${PORT}`,
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { EJB_BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`, NODE_USE_ENV_PROXY: process.env.HTTPS_PROXY ? "1" : "", NODE_NO_WARNINGS: "1" },
    },
  ],
});
