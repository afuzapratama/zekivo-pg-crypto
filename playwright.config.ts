import { defineConfig } from "@playwright/test";
const stagingPlayground = process.env.STAGING_PLAYGROUND_E2E === "1";
const port = stagingPlayground ? 3101 : 3100;
const baseURL = process.env.CHECKOUT_BASE_URL ?? `http://127.0.0.1:${port}`;
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname))
  throw new Error(
    "Checkout browser tests only target a loopback development server",
  );
export default defineConfig({
  testDir: "./tests/browser",
  outputDir:
    process.env.LOCAL_CHAIN_E2E === "1"
      ? "test-results/chain"
      : "test-results/ui",
  webServer: process.env.CHECKOUT_BASE_URL
    ? undefined
    : {
        command: `pnpm --filter @zekivo/web exec next start --hostname 127.0.0.1 --port ${port}`,
        ...(stagingPlayground
          ? {
              env: {
                APP_ENV: "staging",
                SOLANA_CLUSTER: "devnet",
                API_PUBLIC_URL: "https://staging-api.example.test",
              },
            }
          : {}),
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
      },
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    browserName: "chromium",
    // Trace/network artifacts can contain capability URLs; screenshots contain only page content.
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "narrow",
      use: {
        viewport: { width: 320, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
