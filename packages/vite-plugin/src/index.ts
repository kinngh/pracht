import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Connect, Plugin, ViteDevServer } from "vite";

import { createCloudflareServerEntryModule } from "@viact/adapter-cloudflare";
import { createVercelServerEntryModule } from "@viact/adapter-vercel";

export const VIACT_CLIENT_MODULE_ID = "virtual:viact/client";
export const VIACT_SERVER_MODULE_ID = "virtual:viact/server";

// Browser-safe path alias — the colon in "virtual:" is parsed as a protocol
// scheme by browsers, so we serve the client module from a plain path.
const CLIENT_BROWSER_PATH = "/@viact/client.js";

// Vite 8's SSR build prepends the project root to entry IDs before calling
// resolveId, so we may receive "/abs/path/virtual:viact/server" instead of
// just "virtual:viact/server".  These helpers match both forms.
function isClientModule(id: string): boolean {
  return (
    id === VIACT_CLIENT_MODULE_ID ||
    id === CLIENT_BROWSER_PATH ||
    id.endsWith(VIACT_CLIENT_MODULE_ID)
  );
}

function isServerModule(id: string): boolean {
  return (
    id === VIACT_SERVER_MODULE_ID || id.endsWith(VIACT_SERVER_MODULE_ID)
  );
}

export interface ViactPluginOptions {
  appFile?: string;
  routesDir?: string;
  shellsDir?: string;
  middlewareDir?: string;
  apiDir?: string;
  adapter?: ViactAdapter;
  cloudflareAssetsBinding?: string;
  vercelFunctionName?: string;
  vercelRegions?: string | string[];
}

export type ViactAdapter = "node" | "cloudflare" | "vercel";

type ResolvedViactPluginOptions = Omit<Required<ViactPluginOptions>, "vercelRegions"> & {
  vercelRegions: string | string[] | undefined;
};

const DEFAULTS: ResolvedViactPluginOptions = {
  appFile: "/src/routes.ts",
  middlewareDir: "/src/middleware",
  routesDir: "/src/routes",
  shellsDir: "/src/shells",
  apiDir: "/src/api",
  adapter: "node",
  cloudflareAssetsBinding: "ASSETS",
  vercelFunctionName: "render",
  vercelRegions: undefined as string | string[] | undefined,
};

export function viact(options: ViactPluginOptions = {}): Plugin {
  const resolved = resolveOptions(options);
  let root = process.cwd();

  return {
    name: "viact",
    enforce: "pre",

    config() {
      return { appType: "custom" as const };
    },

    configResolved(config) {
      root = config.root;
    },

    resolveId(id) {
      if (isClientModule(id)) return VIACT_CLIENT_MODULE_ID;
      if (isServerModule(id)) return VIACT_SERVER_MODULE_ID;
      return null;
    },

    load(id) {
      if (isClientModule(id)) {
        return createViactClientModuleSource(resolved);
      }
      if (isServerModule(id)) {
        return createViactServerModuleSource(resolved, { root });
      }
      return null;
    },

    configureServer(server) {
      return () => {
        server.middlewares.use(createDevSSRMiddleware(server, resolved));
      };
    },

    handleHotUpdate({ file, server }) {
      const root = server.config.root;
      const relative = file.startsWith(root) ? file.slice(root.length) : file;

      // App manifest changed — full reload (route definitions may have changed)
      if (relative === resolved.appFile) {
        const serverMod = server.moduleGraph.getModuleById(VIACT_SERVER_MODULE_ID);
        const clientMod = server.moduleGraph.getModuleById(VIACT_CLIENT_MODULE_ID);
        if (serverMod) server.moduleGraph.invalidateModule(serverMod);
        if (clientMod) server.moduleGraph.invalidateModule(clientMod);
        server.hot.send({ type: "full-reload" });
        return [];
      }

      // Route/shell/middleware/API file changed — invalidate server module
      // so the registry re-evaluates on next request.
      const dirs = [resolved.routesDir, resolved.shellsDir, resolved.middlewareDir, resolved.apiDir];
      if (dirs.some((dir) => relative.startsWith(dir))) {
        const serverMod = server.moduleGraph.getModuleById(VIACT_SERVER_MODULE_ID);
        if (serverMod) server.moduleGraph.invalidateModule(serverMod);
        // Don't return [] — let Vite's default HMR handle the component update
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Virtual module source generators
// ---------------------------------------------------------------------------

export function createViactClientModuleSource(
  options: ViactPluginOptions = {},
): string {
  const resolved = resolveOptions(options);

  return [
    'import { resolveApp, initClientRouter } from "viact";',
    `import { app } from ${JSON.stringify(resolved.appFile)};`,
    "",
    `const routeModules = import.meta.glob(${JSON.stringify(`${resolved.routesDir}/**/*.{ts,tsx,js,jsx}`)});`,
    `const shellModules = import.meta.glob(${JSON.stringify(`${resolved.shellsDir}/**/*.{ts,tsx,js,jsx}`)});`,
    "",
    "const resolvedApp = resolveApp(app);",
    "",
    "function findModuleKey(modules, file) {",
    '  if (file in modules) return file;',
    '  const suffix = file.replace(/^\\.\\//,"");',
    "  for (const key of Object.keys(modules)) {",
    '    if (key.endsWith("/" + suffix) || key.endsWith(suffix)) return key;',
    "  }",
    "  return null;",
    "}",
    "",
    "const state = window.__VIACT_STATE__;",
    'const root = document.getElementById("viact-root");',
    "if (state && root) {",
    "  initClientRouter({",
    "    app: resolvedApp,",
    "    routeModules,",
    "    shellModules,",
    "    initialState: state,",
    "    root,",
    "    findModuleKey,",
    "  });",
    "}",
    "",
  ].join("\n");
}

export function createViactServerModuleSource(
  options: ViactPluginOptions = {},
  buildOptions: {
    root?: string;
  } = {},
): string {
  const resolved = resolveOptions(options);
  const registrySource = createViactRegistryModuleSource(resolved);
  const clientBuild = readClientBuildAssets(buildOptions.root);
  const viactImport =
    resolved.adapter === "cloudflare" || resolved.adapter === "vercel"
      ? 'import { handleViactRequest, resolveApp, resolveApiRoutes } from "viact";'
      : 'import { resolveApp, resolveApiRoutes } from "viact";';

  const source = [
    viactImport,
    `import { app } from ${JSON.stringify(resolved.appFile)};`,
    "",
    registrySource,
    "",
    "export const resolvedApp = resolveApp(app);",
    `export const apiRoutes = resolveApiRoutes(Object.keys(apiModules), ${JSON.stringify(resolved.apiDir)});`,
    `export const buildTarget = ${JSON.stringify(resolved.adapter)};`,
    `export const clientEntryUrl = ${JSON.stringify(clientBuild.clientEntryUrl)};`,
    `export const cssUrls = ${JSON.stringify(clientBuild.cssUrls)};`,
    "",
  ];

  if (resolved.adapter === "cloudflare") {
    source.push(
      createCloudflareServerEntryModule({
        assetsBinding: resolved.cloudflareAssetsBinding,
      }),
    );
  }

  if (resolved.adapter === "vercel") {
    source.push(
      createVercelServerEntryModule({
        functionName: resolved.vercelFunctionName,
        regions: resolved.vercelRegions,
      }),
    );
  }

  return source.join("\n");
}

export function createViactRegistryModuleSource(
  options: ViactPluginOptions = {},
): string {
  const resolved = resolveOptions(options);

  return [
    `export const routeModules = import.meta.glob(${JSON.stringify(`${resolved.routesDir}/**/*.{ts,tsx,js,jsx}`)});`,
    `export const shellModules = import.meta.glob(${JSON.stringify(`${resolved.shellsDir}/**/*.{ts,tsx,js,jsx}`)});`,
    `export const middlewareModules = import.meta.glob(${JSON.stringify(`${resolved.middlewareDir}/**/*.{ts,tsx,js,jsx}`)});`,
    `export const apiModules = import.meta.glob(${JSON.stringify(`${resolved.apiDir}/**/*.{ts,js}`)});`,
    "",
    "export const registry = {",
    "  routeModules,",
    "  shellModules,",
    "  middlewareModules,",
    "  apiModules,",
    "};",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Dev SSR middleware
// ---------------------------------------------------------------------------

function createDevSSRMiddleware(
  server: ViteDevServer,
  _pluginOptions: ResolvedViactPluginOptions,
): Connect.NextHandleFunction {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction,
  ) => {
    const url = req.url ?? "/";

    // Let Vite handle assets (have file extensions) and node_modules.
    // Page routes are clean URLs without dots.
    if (url.includes(".") || url.startsWith("/node_modules/")) {
      return next();
    }

    try {
      // Load the framework and server module through Vite's SSR pipeline
      const [framework, serverMod] = await Promise.all([
        server.ssrLoadModule("viact"),
        server.ssrLoadModule(VIACT_SERVER_MODULE_ID),
      ]);

      const webRequest = await nodeToWebRequest(req);
      const response = await framework.handleViactRequest({
        app: serverMod.resolvedApp,
        registry: serverMod.registry,
        request: webRequest,
        clientEntryUrl: CLIENT_BROWSER_PATH,
        apiRoutes: serverMod.apiRoutes,
      });

      // If the framework returned 404, fall through to Vite's default handling
      if (response.status === 404) {
        return next();
      }

      const contentType = response.headers.get("content-type") ?? "text/html";
      let body = await response.text();

      // Only transform HTML responses (inject Vite HMR client etc.)
      if (contentType.includes("text/html")) {
        body = await server.transformIndexHtml(url, body);
      }

      res.statusCode = response.status;
      response.headers.forEach((value: string, key: string) => {
        res.setHeader(key, value);
      });
      res.end(body);
    } catch (error: unknown) {
      if (error instanceof Error) {
        server.ssrFixStacktrace(error);
      }
      next(error);
    }
  };
}

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

async function nodeToWebRequest(req: IncomingMessage): Promise<Request> {
  const protocol =
    (Array.isArray(req.headers["x-forwarded-proto"])
      ? req.headers["x-forwarded-proto"][0]
      : req.headers["x-forwarded-proto"]) ?? "http";
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  const method = req.method ?? "GET";

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const init: RequestInit = { method, headers };

  if (!BODYLESS_METHODS.has(method.toUpperCase())) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const body = Buffer.concat(chunks);
    if (body.byteLength > 0) {
      init.body = body;
    }
  }

  return new Request(url, init);
}

function resolveOptions(
  options: ViactPluginOptions,
): ResolvedViactPluginOptions {
  return {
    ...DEFAULTS,
    ...options,
  };
}

function readClientBuildAssets(root = process.cwd()): {
  clientEntryUrl: string | null;
  cssUrls: string[];
} {
  const manifestPath = resolve(root, "dist/client/.vite/manifest.json");
  if (!existsSync(manifestPath)) {
    return { clientEntryUrl: null, cssUrls: [] };
  }

  const rawManifest = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(rawManifest) as Record<string, ViteManifestEntry>;
  const clientEntry = manifest[VIACT_CLIENT_MODULE_ID];

  return {
    clientEntryUrl: clientEntry ? `/${clientEntry.file}` : null,
    cssUrls: (clientEntry?.css ?? []).map((file) => `/${file}`),
  };
}

interface ViteManifestEntry {
  file: string;
  css?: string[];
}
