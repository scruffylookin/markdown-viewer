import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  // Each test launches its own persistent context with the extension loaded.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  projects: [{ name: 'chromium-extension' }],
});
