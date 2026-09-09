import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser', timeout: 30000, workers: 1, retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173/talbot/', trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/serve-dist.mjs', url: 'http://127.0.0.1:4173/talbot/', reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } },
  ],
});
