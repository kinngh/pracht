#!/usr/bin/env node --experimental-strip-types

import { createServer as createHttpServer } from "node:http";
import { resolve, join, extname } from "node:path";
import { existsSync, statSync, createReadStream, readFileSync } from "node:fs";
import { createServer, build as viteBuild } from "vite";

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
  console.error(`Unknown viact command: ${command}`);
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
  const server = await createServer({
    root: process.cwd(),
    server: { port: 3000 },
  });

  await server.listen();
  server.printUrls();
}

async function build() {
  // 1. Client build
  console.log("\n  Building client...\n");
  await viteBuild({
    root: process.cwd(),
    build: {
      outDir: "dist/client",
      rollupOptions: {
        input: "virtual:viact/client",
      },
    },
  });

  // 2. SSR build
  console.log("\n  Building server...\n");
  await viteBuild({
    root: process.cwd(),
    build: {
      ssr: "virtual:viact/server",
      outDir: "dist/server",
    },
  });

  console.log("\n  Build complete.\n");
}

async function preview() {
  const root = process.cwd();
  const clientDir = resolve(root, "dist/client");
  const serverEntry = resolve(root, "dist/server/virtual_viact_server.js");

  if (!existsSync(serverEntry)) {
    console.error(
      "Server build not found at dist/server/. Run `viact build` first.",
    );
    process.exit(1);
  }

  const serverMod = await import(serverEntry);
  const { handleViactRequest } = await import("viact");

  // Read the Vite manifest for asset URLs
  const manifestPath = resolve(clientDir, ".vite/manifest.json");
  const viteManifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf-8"))
    : {};

  // Find the client entry asset from the manifest
  const clientEntry = viteManifest["virtual:viact/client"];
  const clientEntryUrl = clientEntry ? `/${clientEntry.file}` : undefined;
  const cssUrls = (clientEntry?.css ?? []).map((f) => `/${f}`);

  const MIME_TYPES = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };

  const port = parseInt(process.argv[3] || "3000", 10);

  const server = createHttpServer(async (req, res) => {
    const url = req.url ?? "/";

    // Try static file first
    const filePath = join(clientDir, url);
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath);
      res.setHeader(
        "content-type",
        MIME_TYPES[ext] || "application/octet-stream",
      );
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
      const webRequest = new Request(
        new URL(url, `${protocol}://${host}`),
        { method: req.method, headers },
      );

      const response = await handleViactRequest({
        app: serverMod.resolvedApp,
        registry: serverMod.registry,
        request: webRequest,
        clientEntryUrl,
        cssUrls,
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
    console.log(
      `\n  viact preview server running at http://localhost:${port}\n`,
    );
  });
}

function printHelp() {
  console.log(`viact ${VERSION}

Usage:
  viact dev       Start development server with HMR
  viact build     Production build (client + server)
  viact preview   Preview the production build
`);
}
