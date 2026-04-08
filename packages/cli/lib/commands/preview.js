import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { extname, join, resolve } from "node:path";

import { createReadStreamResponse, setDefaultSecurityHeaders } from "../build-shared.js";
import { parseFlags } from "../cli.js";

const MIME_TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".jpg": "image/jpeg",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function previewCommand(args) {
  const options = parseFlags(args);
  const root = process.cwd();
  const clientDir = resolve(root, "dist/client");
  const serverEntry = resolve(root, "dist/server/server.js");

  if (!existsSync(serverEntry)) {
    throw new Error("Server build not found at dist/server/. Run `pracht build` first.");
  }

  const serverMod = await import(serverEntry);
  const { handlePrachtRequest } = await import("@pracht/core");
  const isgManifestPath = resolve(root, "dist/server/isg-manifest.json");
  const isgManifest = existsSync(isgManifestPath)
    ? JSON.parse(readFileSync(isgManifestPath, "utf-8"))
    : {};
  const manifestPath = resolve(clientDir, ".vite/manifest.json");
  const viteManifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf-8"))
    : {};
  const clientEntry = viteManifest["virtual:pracht/client"];
  const clientEntryUrl = clientEntry ? `/${clientEntry.file}` : undefined;
  const cssUrls = (clientEntry?.css ?? []).map((file) => `/${file}`);
  const port = parseInt(process.env.PORT || options._[0] || "3000", 10);

  const server = createHttpServer(async (req, res) => {
    const url = req.url ?? "/";
    const parsedUrl = new URL(url, "http://localhost");

    if (req.method === "GET" && parsedUrl.pathname in isgManifest) {
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
          "x-pracht-isg": isStale ? "stale" : "fresh",
        });
        createReadStreamResponse(htmlPath, res);

        if (isStale) {
          const regenRequest = new Request(new URL(parsedUrl.pathname, "http://localhost"), {
            method: "GET",
          });
          handlePrachtRequest({
            app: serverMod.resolvedApp,
            clientEntryUrl,
            cssUrls,
            registry: serverMod.registry,
            request: regenRequest,
          })
            .then(async (response) => {
              if (response.status === 200) {
                writeFileSync(htmlPath, await response.text(), "utf-8");
              }
            })
            .catch((error) => {
              console.error(`ISG regeneration failed for ${parsedUrl.pathname}:`, error);
            });
        }
        return;
      }
    }

    const filePath = resolve(clientDir, "." + url);
    if (!filePath.startsWith(clientDir + "/") && filePath !== clientDir) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath);
      const headers = {
        "content-type": MIME_TYPES[ext] || "application/octet-stream",
      };
      if (ext === ".html") {
        setDefaultSecurityHeaders(res, headers);
      } else {
        for (const [key, value] of Object.entries(headers)) {
          res.setHeader(key, value);
        }
      }
      createReadStreamResponse(filePath, res);
      return;
    }

    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) headers.append(key, item);
        } else {
          headers.set(key, value);
        }
      }

      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host || "localhost";
      const webRequest = new Request(new URL(url, `${protocol}://${host}`), {
        headers,
        method: req.method,
      });

      const response = await handlePrachtRequest({
        apiRoutes: serverMod.apiRoutes,
        app: serverMod.resolvedApp,
        clientEntryUrl,
        cssUrls,
        registry: serverMod.registry,
        request: webRequest,
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
    } catch (error) {
      console.error("SSR error:", error);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  server.listen(port, () => {
    console.log(`\n  pracht preview server running at http://localhost:${port}\n`);
  });
}
