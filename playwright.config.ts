import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'on-first-retry',
    // software WebGL so the 3D view also runs on GPU-less CI machines. E2E_GPU=1 uses the
    // installed Chrome with the real GPU instead (used to render docs/screenshots).
    launchOptions: process.env.E2E_GPU
      ? { channel: 'chrome', args: ['--ignore-gpu-blocklist'] }
      : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    // test the production bundle (lazy chunks, no dev-only code paths)
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    port: PORT,
    // always build and serve fresh: a stale `vite preview` on this port would test old code.
    // Set E2E_REUSE_SERVER=1 to reuse a server you started yourself.
    reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
    timeout: 180_000,
  },
});
