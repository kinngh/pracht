import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin, ViteDevServer } from "vite";

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
}

const DEFAULTS: Required<ViactPluginOptions> = {
  appFile: "/src/routes.ts",
  middlewareDir: "/src/middleware",
  routesDir: "/src/routes",
  shellsDir: "/src/shells",
};

export function viact(options: ViactPluginOptions = {}): Plugin {
  const resolved = resolveOptions(options);

  return {
    name: "viact",
    enforce: "pre",

    config() {
      return { appType: "custom" as const };
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
        return createViactServerModuleSource(resolved);
      }
      return null;
    },

    configureServer(server) {
      return () => {
        server.middlewares.use(createDevSSRMiddleware(server, resolved));
      };
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
): string {
  const resolved = resolveOptions(options);
  const registrySource = createViactRegistryModuleSource(resolved);

  return [
    'import { resolveApp } from "viact";',
    `import { app } from ${JSON.stringify(resolved.appFile)};`,
    "",
    registrySource,
    "",
    "export const resolvedApp = resolveApp(app);",
    "",
  ].join("\n");
}

export function createViactRegistryModuleSource(
  options: ViactPluginOptions = {},
): string {
  const resolved = resolveOptions(options);

  return [
    `export const routeModules = import.meta.glob(${JSON.stringify(`${resolved.routesDir}/**/*.{ts,tsx,js,jsx}`)});`,
    `export const shellModules = import.meta.glob(${JSON.stringify(`${resolved.shellsDir}/**/*.{ts,tsx,js,jsx}`)});`,
    `export const middlewareModules = import.meta.glob(${JSON.stringify(`${resolved.middlewareDir}/**/*.{ts,tsx,js,jsx}`)});`,
    "",
    "export const registry = {",
    "  routeModules,",
    "  shellModules,",
    "  middlewareModules,",
    "};",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Dev SSR middleware
// ---------------------------------------------------------------------------

function createDevSSRMiddleware(
  server: ViteDevServer,
  _pluginOptions: Required<ViactPluginOptions>,
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

      const webRequest = nodeToWebRequest(req);
      const response = await framework.handleViactRequest({
        app: serverMod.resolvedApp,
        registry: serverMod.registry,
        request: webRequest,
        clientEntryUrl: CLIENT_BROWSER_PATH,
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

function nodeToWebRequest(req: IncomingMessage): Request {
  const protocol =
    (Array.isArray(req.headers["x-forwarded-proto"])
      ? req.headers["x-forwarded-proto"][0]
      : req.headers["x-forwarded-proto"]) ?? "http";
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  return new Request(url, {
    method: req.method ?? "GET",
    headers,
  });
}

function resolveOptions(
  options: ViactPluginOptions,
): Required<ViactPluginOptions> {
  return {
    ...DEFAULTS,
    ...options,
  };
}
