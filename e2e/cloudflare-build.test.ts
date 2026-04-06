import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

test("viact build emits a deployable Cloudflare Worker setup", async () => {
  test.setTimeout(120_000);

  const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  const exampleDir = resolve(repoRoot, "examples/basic");
  const distDir = resolve(exampleDir, "dist");
  const wranglerPath = resolve(exampleDir, "dist/server/wrangler.json");
  const serverEntryPath = resolve(exampleDir, "dist/server/server.js");

  rmSync(distDir, { force: true, recursive: true });

  execFileSync(process.execPath, ["../../packages/cli/bin/viact.js", "build"], {
    cwd: exampleDir,
    env: {
      ...process.env,
      NODE_OPTIONS: "--experimental-strip-types",
    },
    stdio: "pipe",
  });

  expect(existsSync(wranglerPath)).toBe(true);
  expect(existsSync(serverEntryPath)).toBe(true);

  const wranglerConfig = JSON.parse(readFileSync(wranglerPath, "utf-8"));
  expect(wranglerConfig).toMatchObject({
    main: "./server.js",
    assets: {
      directory: "../client",
      binding: "ASSETS",
      run_worker_first: true,
    },
  });
  expect(wranglerConfig.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const workerSource = readFileSync(serverEntryPath, "utf-8");
  expect(workerSource).toContain("cloudflareAssetsBinding");
  expect(workerSource).toContain('buildTarget = "cloudflare"');
  expect(workerSource).toContain("server_default as default");
});
