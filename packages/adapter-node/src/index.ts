import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";

import {
  applyDefaultSecurityHeaders,
  handleViactRequest,
  type HandleViactRequestOptions,
  type ISGManifestEntry,
  type ModuleRegistry,
  type ResolvedApiRoute,
  type ViactApp,
} from "viact";

export interface NodeAdapterContextArgs {
  request: Request;
  req: IncomingMessage;
  res: ServerResponse;
}

export interface NodeAdapterOptions<TContext = unknown> {
  app: ViactApp;
  registry?: ModuleRegistry;
  staticDir?: string;
  viteManifest?: unknown;
  isgManifest?: Record<string, ISGManifestEntry>;
  apiRoutes?: ResolvedApiRoute[];
  clientEntryUrl?: string;
  cssUrls?: string[];
  createContext?: (
    args: NodeAdapterContextArgs,
  ) => TContext | Promise<TContext>;
}

export interface NodeServerEntryModuleOptions {
  appImportPath?: string;
  port?: number;
}

export function createNodeRequestHandler<TContext = unknown>(
  options: NodeAdapterOptions<TContext>,
) {
  const isgManifest = options.isgManifest ?? {};
  const staticDir = options.staticDir;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const request = await createWebRequest(req);
    const url = new URL(request.url);

    // --- ISG stale-while-revalidate for GET requests ---
    if (staticDir && request.method === "GET" && url.pathname in isgManifest) {
      const entry = isgManifest[url.pathname];
      const htmlPath = url.pathname === "/"
        ? join(staticDir, "index.html")
        : join(staticDir, url.pathname, "index.html");

      if (existsSync(htmlPath)) {
        const stat = statSync(htmlPath);
        const ageMs = Date.now() - stat.mtimeMs;
        const isStale =
          entry.revalidate.kind === "time" &&
          ageMs > entry.revalidate.seconds * 1000;

        // Serve the cached file
        const html = await readFile(htmlPath, "utf-8");
        res.statusCode = 200;
        const headers = applyDefaultSecurityHeaders(new Headers({
          "content-type": "text/html; charset=utf-8",
          "x-viact-isg": isStale ? "stale" : "fresh",
        }));
        headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        res.end(html);

        // Background regeneration if stale
        if (isStale) {
          regenerateISGPage(options, url.pathname, htmlPath).catch((err) => {
            console.error(`ISG regeneration failed for ${url.pathname}:`, err);
          });
        }

        return;
      }
    }

    const context = options.createContext
      ? await options.createContext({ request, req, res })
      : undefined;

    const response = await handleViactRequest({
      app: options.app,
      context,
      registry: options.registry,
      request,
      apiRoutes: options.apiRoutes,
      clientEntryUrl: options.clientEntryUrl,
      cssUrls: options.cssUrls,
    } satisfies HandleViactRequestOptions<TContext>);

    // Cache ISG responses on first render
    if (
      staticDir &&
      request.method === "GET" &&
      url.pathname in isgManifest &&
      response.status === 200
    ) {
      const html = await response.clone().text();
      const htmlPath = url.pathname === "/"
        ? join(staticDir, "index.html")
        : join(staticDir, url.pathname, "index.html");
      mkdirSync(dirname(htmlPath), { recursive: true });
      writeFileSync(htmlPath, html, "utf-8");
    }

    await writeWebResponse(res, response);
  };
}

async function regenerateISGPage<TContext>(
  options: NodeAdapterOptions<TContext>,
  pathname: string,
  htmlPath: string,
): Promise<void> {
  const url = new URL(pathname, "http://localhost");
  const request = new Request(url, { method: "GET" });

  const response = await handleViactRequest({
    app: options.app,
    registry: options.registry,
    request,
    clientEntryUrl: options.clientEntryUrl,
    cssUrls: options.cssUrls,
  });

  if (response.status === 200) {
    const html = await response.text();
    mkdirSync(dirname(htmlPath), { recursive: true });
    writeFileSync(htmlPath, html, "utf-8");
  }
}

export function createNodeServerEntryModule(
  options: NodeServerEntryModuleOptions = {},
): string {
  const appImportPath = options.appImportPath ?? "/src/routes.ts";
  const port = options.port ?? 3000;

  return [
    'import { createServer } from "node:http";',
    'import { createNodeRequestHandler } from "@viact/adapter-node";',
    `import { app } from ${JSON.stringify(appImportPath)};`,
    "",
    "const handler = createNodeRequestHandler({ app });",
    "const server = createServer(handler);",
    `server.listen(${port});`,
    "",
  ].join("\n");
}

async function createWebRequest(req: IncomingMessage): Promise<Request> {
  const protocol = getFirstHeaderValue(req.headers["x-forwarded-proto"]) ?? "http";
  const host = getFirstHeaderValue(req.headers.host) ?? "localhost";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  const method = req.method ?? "GET";
  const headers = createHeaders(req.headers);
  const init: RequestInit = {
    headers,
    method,
  };

  if (!BODYLESS_METHODS.has(method.toUpperCase())) {
    const body = await readRequestBody(req);
    if (body.byteLength > 0) {
      const exactBody = new Uint8Array(body.byteLength);
      exactBody.set(body);
      init.body = exactBody.buffer;
    }
  }

  return new Request(url, init);
}

function createHeaders(headers: IncomingMessage["headers"]): Headers {
  const result = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "undefined") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        result.append(key, entry);
      }

      continue;
    }

    result.set(key, value);
  }

  return result;
}

async function readRequestBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of req) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function writeWebResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

function getFirstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
