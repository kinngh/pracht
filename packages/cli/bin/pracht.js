#!/usr/bin/env node

import { createServer as createHttpServer } from "node:http";
import { resolve, join, dirname, extname } from "node:path";
import {
  existsSync,
  statSync,
  mkdirSync,
  writeFileSync,
  createReadStream,
  readFileSync,
  readdirSync,
  rmSync,
  cpSync,
} from "node:fs";
import { createServer, build as viteBuild } from "vite";

const DEFAULT_SECURITY_HEADERS = {
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
};
const ROUTE_STATE_REQUEST_HEADER = "x-pracht-route-state-request";

const VERSION = "0.0.0";
const command = process.argv[2];

if (!command || command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log(VERSION);
  process.exit(0);
}

const handlers = { dev, build, preview };

if (!(command in handlers)) {
  console.error(`Unknown pracht command: ${command}`);
  printHelp();
  process.exit(1);
}

handlers[command]().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function dev() {
  const port = parseInt(process.env.PORT || process.argv[3] || "3000", 10);

  const server = await createServer({
    root: process.cwd(),
    server: { port },
  });

  await server.listen();
  server.printUrls();
}

async function build() {
  const root = process.cwd();

  // 1. Client build
  // outDir is "dist" for all adapters. Cloudflare's environment API (via
  // @cloudflare/vite-plugin) writes the client environment to dist/client/
  // automatically.  For plain Vite builds (Node, Vercel) assets land directly
  // in dist/.  After the build we detect where the manifest ended up and set
  // clientDir accordingly.
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

  // 2. SSR build
  console.log("\n  Building server...\n");
  await viteBuild({
    root,
    build: {
      ssr: "virtual:pracht/server",
      outDir: "dist/server",
    },
  });

  // 3. SSG prerendering
  const serverEntry = resolve(root, "dist/server/server.js");

  // Detect where the client build landed — Cloudflare env API writes to
  // dist/client/, plain Vite writes directly to dist/.  Normalize to
  // dist/client/ so the server adapter can always resolve staticDir as
  // "../client" relative to dist/server/.
  let clientDir;
  if (existsSync(resolve(root, "dist/client/.vite/manifest.json"))) {
    clientDir = resolve(root, "dist/client");
  } else {
    clientDir = resolve(root, "dist/client");
    // Move assets from dist/ into dist/client/
    const distRoot = resolve(root, "dist");
    mkdirSync(clientDir, { recursive: true });
    for (const entry of readdirSync(distRoot)) {
      if (entry === "server" || entry === "client") continue;
      const src = join(distRoot, entry);
      const dest = join(clientDir, entry);
      cpSync(src, dest, { recursive: true });
      rmSync(src, { force: true, recursive: true });
    }
  }

  if (existsSync(serverEntry)) {
    const serverMod = await import(serverEntry);
    // Use prerenderApp from the server bundle to share the same Preact context
    // instances as route/shell modules — avoids dual-copy issues during SSG.
    const { prerenderApp } = serverMod;

    // Read the Vite manifest for asset URLs
    const manifestPath = resolve(clientDir, ".vite/manifest.json");
    const viteManifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf-8"))
      : {};

    const clientEntry = viteManifest["virtual:pracht/client"];
    const clientEntryUrl = clientEntry ? `/${clientEntry.file}` : undefined;

    // Build per-source-file CSS manifest by walking static imports transitively.
    // This ensures each page gets only the CSS it actually needs.
    function collectTransitiveCss(key) {
      const css = new Set();
      const visited = new Set();
      function collect(k) {
        if (visited.has(k)) return;
        visited.add(k);
        const entry = viteManifest[k];
        if (!entry) return;
        for (const c of entry.css ?? []) css.add(c);
        for (const imp of entry.imports ?? []) collect(imp);
      }
      collect(key);
      return [...css];
    }

    const cssManifest = {};
    for (const [key, entry] of Object.entries(viteManifest)) {
      if (!entry.src) continue;
      const css = collectTransitiveCss(key);
      if (css.length > 0) {
        cssManifest[key] = css.map((f) => `/${f}`);
      }
    }

    const { pages, isgManifest } = await prerenderApp({
      app: serverMod.resolvedApp,
      registry: serverMod.registry,
      clientEntryUrl,
      cssManifest,
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

    // Write ISG manifest for the preview/production server
    if (Object.keys(isgManifest).length > 0) {
      const isgManifestPath = resolve(root, "dist/server/isg-manifest.json");
      writeFileSync(isgManifestPath, JSON.stringify(isgManifest, null, 2), "utf-8");
      console.log(
        `\n  ISG manifest → dist/server/isg-manifest.json (${Object.keys(isgManifest).length} route(s))\n`,
      );
    }

    if (serverMod.buildTarget === "cloudflare") {
      console.log(`\n  Cloudflare worker → dist/server/server.js\n`);
      console.log(`  Deploy with: wrangler deploy\n`);
    }

    if (serverMod.buildTarget === "vercel") {
      const outputPath = writeVercelBuildOutput({
        functionName: serverMod.vercelFunctionName,
        regions: serverMod.vercelRegions,
        root,
        staticRoutes: pages.map((page) => page.path).filter((path) => !(path in isgManifest)),
        isgRoutes: Object.keys(isgManifest),
      });

      console.log(`\n  Vercel build output → ${outputPath}\n`);
    }
  }

  console.log("\n  Build complete.\n");
}

async function preview() {
  const root = process.cwd();
  const clientDir = resolve(root, "dist/client");
  const serverEntry = resolve(root, "dist/server/server.js");

  if (!existsSync(serverEntry)) {
    console.error("Server build not found at dist/server/. Run `pracht build` first.");
    process.exit(1);
  }

  const serverMod = await import(serverEntry);
  const { handlePrachtRequest } = await import("@pracht/core");

  // Load ISG manifest if it exists
  const isgManifestPath = resolve(root, "dist/server/isg-manifest.json");
  const isgManifest = existsSync(isgManifestPath)
    ? JSON.parse(readFileSync(isgManifestPath, "utf-8"))
    : {};

  // Read the Vite manifest for asset URLs
  const manifestPath = resolve(clientDir, ".vite/manifest.json");
  const viteManifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf-8"))
    : {};

  // Find the client entry asset from the manifest
  const clientEntry = viteManifest["virtual:pracht/client"];
  const clientEntryUrl = clientEntry ? `/${clientEntry.file}` : undefined;
  const cssUrls = (clientEntry?.css ?? []).map((f) => `/${f}`);

  const MIME_TYPES = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".txt": "text/plain",
    ".xml": "application/xml",
    ".webmanifest": "application/manifest+json",
  };

  const HASHED_ASSET_RE = /\/assets\//;

  function getCacheControl(urlPath) {
    if (HASHED_ASSET_RE.test(urlPath)) {
      return "public, max-age=31536000, immutable";
    }

    return "public, max-age=0, must-revalidate";
  }

  const port = parseInt(process.argv[3] || "3000", 10);

  const server = createHttpServer(async (req, res) => {
    const url = req.url ?? "/";
    const parsedUrl = new URL(url, "http://localhost");
    const isRouteStateRequest = req.headers[ROUTE_STATE_REQUEST_HEADER] === "1";

    // ISG stale-while-revalidate check
    if (req.method === "GET" && !isRouteStateRequest && parsedUrl.pathname in isgManifest) {
      const entry = isgManifest[parsedUrl.pathname];
      const htmlPath =
        parsedUrl.pathname === "/"
          ? join(clientDir, "index.html")
          : join(clientDir, parsedUrl.pathname, "index.html");

      if (existsSync(htmlPath) && statSync(htmlPath).isFile()) {
        const stat = statSync(htmlPath);
        const ageMs = Date.now() - stat.mtimeMs;
        const isStale = entry.revalidate.kind === "time" && ageMs > entry.revalidate.seconds * 1000;

        setDefaultSecurityHeaders(res, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=0, must-revalidate",
          "x-pracht-isg": isStale ? "stale" : "fresh",
          vary: ROUTE_STATE_REQUEST_HEADER,
        });
        createReadStream(htmlPath).pipe(res);

        if (isStale) {
          // Background regeneration
          const regenRequest = new Request(new URL(parsedUrl.pathname, "http://localhost"), {
            method: "GET",
          });
          handlePrachtRequest({
            app: serverMod.resolvedApp,
            registry: serverMod.registry,
            request: regenRequest,
            clientEntryUrl,
            cssUrls,
          })
            .then(async (response) => {
              if (response.status === 200) {
                const { mkdirSync, writeFileSync } = await import("node:fs");
                mkdirSync(dirname(htmlPath), { recursive: true });
                writeFileSync(htmlPath, await response.text(), "utf-8");
              }
            })
            .catch((err) => {
              console.error(`ISG regeneration failed for ${parsedUrl.pathname}:`, err);
            });
        }
        return;
      }
    }

    // Try static file first
    const filePath = resolve(clientDir, "." + url);
    if (!filePath.startsWith(clientDir + "/") && filePath !== clientDir) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath);
      const cacheControl = getCacheControl(url);
      const headers = {
        "content-type": MIME_TYPES[ext] || "application/octet-stream",
        "cache-control": cacheControl,
      };
      if (ext === ".html") {
        setDefaultSecurityHeaders(res, headers);
      } else {
        for (const [key, value] of Object.entries(headers)) {
          res.setHeader(key, value);
        }
      }
      createReadStream(filePath).pipe(res);
      return;
    }

    // SSR fallback
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }

      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host || "localhost";
      const webRequest = new Request(new URL(url, `${protocol}://${host}`), {
        method: req.method,
        headers,
      });

      const response = await handlePrachtRequest({
        app: serverMod.resolvedApp,
        registry: serverMod.registry,
        request: webRequest,
        clientEntryUrl,
        cssUrls,
        apiRoutes: serverMod.apiRoutes,
      });

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      if (!response.body) {
        res.end();
        return;
      }

      const body = Buffer.from(await response.arrayBuffer());
      res.end(body);
    } catch (err) {
      console.error("SSR error:", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  server.listen(port, () => {
    console.log(`\n  pracht preview server running at http://localhost:${port}\n`);
  });
}

function printHelp() {
  console.log(`pracht ${VERSION}

Usage:
  pracht dev       Start development server with HMR
  pracht build     Production build (client + server)
  pracht preview   Preview the production build
`);
}

function setDefaultSecurityHeaders(res, headers = {}) {
  for (const [key, value] of Object.entries({
    ...DEFAULT_SECURITY_HEADERS,
    ...headers,
  })) {
    res.setHeader(key, value);
  }
}

function writeVercelBuildOutput({ functionName, regions, root, staticRoutes, isgRoutes }) {
  const outputDir = join(root, ".vercel/output");
  const staticDir = join(outputDir, "static");
  const functionDir = join(outputDir, "functions", `${functionName || "render"}.func`);

  rmSync(outputDir, { force: true, recursive: true });
  mkdirSync(outputDir, { recursive: true });
  cpSync(join(root, "dist/client"), staticDir, { recursive: true });
  cpSync(join(root, "dist/server"), functionDir, { recursive: true });

  writeFileSync(
    join(outputDir, "config.json"),
    `${JSON.stringify(createVercelOutputConfig({ functionName, staticRoutes, isgRoutes }), null, 2)}\n`,
    "utf-8",
  );
  writeFileSync(
    join(functionDir, ".vc-config.json"),
    `${JSON.stringify(createVercelFunctionConfig({ regions }), null, 2)}\n`,
    "utf-8",
  );

  return ".vercel/output";
}

function createVercelOutputConfig({ functionName, staticRoutes, isgRoutes }) {
  const target = `/${functionName || "render"}`;
  const routes = [
    {
      src: "/(.*)",
      has: [{ type: "header", key: ROUTE_STATE_REQUEST_HEADER, value: "1" }],
      dest: target,
    },
  ];

  for (const route of sortStaticRoutes(staticRoutes)) {
    routes.push({
      src: routeToRouteExpression(route),
      dest: routeToStaticHtmlPath(route),
    });
  }

  for (const route of isgRoutes) {
    routes.push({
      src: routeToRouteExpression(route),
      dest: target,
    });
  }

  routes.push({ handle: "filesystem" });
  routes.push({ src: "/(.*)", dest: target });

  return {
    version: 3,
    routes,
    headers: [
      {
        source: "/(.*)",
        headers: [
          {
            key: "permissions-policy",
            value:
              "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
          },
          { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
          { key: "x-content-type-options", value: "nosniff" },
          { key: "x-frame-options", value: "SAMEORIGIN" },
        ],
      },
    ],
    framework: {
      version: VERSION,
    },
  };
}

function createVercelFunctionConfig({ regions }) {
  const config = {
    runtime: "edge",
    entrypoint: "server.js",
  };

  if (regions) {
    config.regions = regions;
  }

  return config;
}

function sortStaticRoutes(routes) {
  return [...new Set(routes)].sort((left, right) => right.length - left.length);
}

function routeToRouteExpression(route) {
  if (route === "/") {
    return "^/$";
  }

  return `^${escapeRegex(route)}/?$`;
}

function routeToStaticHtmlPath(route) {
  if (route === "/") {
    return "/index.html";
  }

  return `${route}/index.html`;
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}
