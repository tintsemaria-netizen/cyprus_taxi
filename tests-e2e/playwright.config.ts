import { defineConfig, devices } from '@playwright/test';

// Runs inside the official Playwright Docker image against a local instance of the
// production build (this host's OS is too old for Playwright's own browser binaries).
export default defineConfig({
  testDir: '.',
  timeout: 60000,
  reporter: [['list']],
  use: {
    baseURL: process.env.QA_BASE_URL || 'http://localhost:3055',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
