import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command:
      "cd examples/cloudflare && NODE_OPTIONS='--experimental-strip-types' node ../../packages/cli/bin/viact.js dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
