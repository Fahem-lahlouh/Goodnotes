import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'off',
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } },
    },
    {
      // Émulation d'un iPad (taille, tactile) dans Chromium : utile pour la mise en page
      // et les gestes, mais ne remplace pas Safari ni un Apple Pencil réels.
      name: 'chromium-ipad',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        deviceScaleFactor: 2,
        hasTouch: true,
      },
    },
    ...(process.env.WEBKIT
      ? [
          {
            name: 'webkit-ipad',
            use: { ...devices['iPad Pro 11'] },
            // Les tests qui pilotent le stylet via le protocole Chromium sont ignorés sur WebKit.
            grepInvert: /@cdp/,
          },
        ]
      : []),
  ],
});
