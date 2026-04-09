import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { build as viteBuild } from "vite";

import { writeVercelBuildOutput } from "../build-shared.js";

export async function buildCommand() {
  const root = process.cwd();

  console.log("\n  Building client...\n");
  await viteBuild({
    root,
    build: {
      outDir: "dist",
      manifest: true,
      rollupOptions: {
        input: "virtual:pracht/client",
      },
    },
  });

  console.log("\n  Building server...\n");
  await viteBuild({
    root,
    build: {
      outDir: "dist/server",
      ssr: "virtual:pracht/server",
    },
  });

  const serverEntry = resolve(root, "dist/server/server.js");
  let clientDir;
  if (existsSync(resolve(root, "dist/client/.vite/manifest.json"))) {
    clientDir = resolve(root, "dist/client");
  } else {
    clientDir = resolve(root, "dist/client");
    const distRoot = resolve(root, "dist");
    mkdirSync(clientDir, { recursive: true });
    for (const entry of readdirSync(distRoot)) {
      if (entry === "server" || entry === "client") continue;
      const sourcePath = join(distRoot, entry);
      const destinationPath = join(clientDir, entry);
      cpSync(sourcePath, destinationPath, { recursive: true });
      rmSync(sourcePath, { force: true, recursive: true });
    }
  }

  if (existsSync(serverEntry)) {
    const serverMod = await import(serverEntry);
    const { prerenderApp } = serverMod;
    const manifestPath = resolve(clientDir, ".vite/manifest.json");
    const viteManifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf-8"))
      : {};

    const clientEntry = viteManifest["virtual:pracht/client"];
    const clientEntryUrl = clientEntry ? `/${clientEntry.file}` : undefined;

    function collectTransitiveCss(key) {
      const css = new Set();
      const visited = new Set();

      function collect(currentKey) {
        if (visited.has(currentKey)) return;
        visited.add(currentKey);
        const entry = viteManifest[currentKey];
        if (!entry) return;
        for (const cssFile of entry.css ?? []) css.add(cssFile);
        for (const importedKey of entry.imports ?? []) collect(importedKey);
      }

      collect(key);
      return [...css];
    }

    const cssManifest = {};
    for (const [key, entry] of Object.entries(viteManifest)) {
      if (!entry.src) continue;
      const css = collectTransitiveCss(key);
      if (css.length > 0) {
        cssManifest[key] = css.map((file) => `/${file}`);
      }
    }

    const { pages, isgManifest } = await prerenderApp({
      app: serverMod.resolvedApp,
      clientEntryUrl,
      cssManifest,
      registry: serverMod.registry,
      withISGManifest: true,
    });

    if (pages.length > 0) {
      console.log(`\n  Prerendering ${pages.length} SSG/ISG route(s)...\n`);
      for (const page of pages) {
        const filePath =
          page.path === "/"
            ? join(clientDir, "index.html")
            : join(clientDir, page.path, "index.html");

        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, page.html, "utf-8");
        console.log(`    ${page.path} → ${filePath.replace(root + "/", "")}`);
      }
    }

    if (Object.keys(isgManifest).length > 0) {
      const isgManifestPath = resolve(root, "dist/server/isg-manifest.json");
      writeFileSync(isgManifestPath, JSON.stringify(isgManifest, null, 2), "utf-8");
      console.log(
        `\n  ISG manifest → dist/server/isg-manifest.json (${Object.keys(isgManifest).length} route(s))\n`,
      );
    }

    if (serverMod.buildTarget === "cloudflare") {
      console.log("\n  Cloudflare worker → dist/server/server.js\n");
      console.log("  Deploy with: wrangler deploy\n");
    }

    if (serverMod.buildTarget === "vercel") {
      const outputPath = writeVercelBuildOutput({
        functionName: serverMod.vercelFunctionName,
        isgRoutes: Object.keys(isgManifest),
        regions: serverMod.vercelRegions,
        root,
        staticRoutes: pages.map((page) => page.path).filter((path) => !(path in isgManifest)),
      });

      console.log(`\n  Vercel build output → ${outputPath}\n`);
    }
  }

  console.log("\n  Build complete.\n");
}
