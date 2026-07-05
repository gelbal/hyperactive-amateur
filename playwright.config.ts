// ABOUTME: Playwright smoke config for production-preview browser coverage.
// ABOUTME: Uses system Chrome on macOS; CI can install Playwright Chromium and unset PLAYWRIGHT_CHANNEL.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const HOST = "127.0.0.1";
const baseURL = `http://${HOST}:${PORT}`;
const channel =
  process.env.PLAYWRIGHT_CHANNEL ??
  (process.platform === "darwin" ? "chrome" : undefined);

export default defineConfig({
  testDir: "./test/browser",
  testMatch: /.*\.pw\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  expect: {
    timeout: 7_500,
  },
  use: {
    baseURL,
    browserName: "chromium",
    channel,
    headless: true,
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run preview -- --host ${HOST} --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
