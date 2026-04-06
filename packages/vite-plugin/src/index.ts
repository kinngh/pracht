import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin, ViteDevServer } from "vite";

export const VIACT_CLIENT_MODULE_ID = "virtual:viact/client";
export const VIACT_SERVER_MODULE_ID = "virtual:viact/server";

// Browser-safe path alias — the colon in "virtual:" is parsed as a protocol
// scheme by browsers, so we serve the client module from a plain path.
const CLIENT_BROWSER_PATH = "/@viact/client.js";

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
      if (
        id === VIACT_CLIENT_MODULE_ID ||
        id === CLIENT_BROWSER_PATH ||
        id === VIACT_SERVER_MODULE_ID
      ) {
        return id;
      }
      return null;
    },

    load(id) {
      if (id === VIACT_CLIENT_MODULE_ID || id === CLIENT_BROWSER_PATH) {
        return createViactClientModuleSource(resolved);
      }
      if (id === VIACT_SERVER_MODULE_ID) {
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
    'import { hydrate, h } from "preact";',
    'import { resolveApp, matchAppRoute, ViactRuntimeProvider } from "viact";',
    `import { app } from ${JSON.stringify(resolved.appFile)};`,
    "",
    `const routeModules = import.meta.glob(${JSON.stringify(`${resolved.routesDir}/**/*.{ts,tsx,js,jsx}`)});`,
    `const shellModules = import.meta.glob(${JSON.stringify(`${resolved.shellsDir}/**/*.{ts,tsx,js,jsx}`)});`,
    "",
    "const resolvedApp = resolveApp(app);",
    "",
    "async function main() {",
    "  const state = window.__VIACT_STATE__;",
    "  if (!state) return;",
    "",
    "  const match = matchAppRoute(resolvedApp, state.url);",
    "  if (!match) return;",
    "",
    "  const routeKey = findModuleKey(routeModules, match.route.file);",
    "  if (!routeKey) return;",
    "  const routeMod = await routeModules[routeKey]();",
    "  if (!routeMod.Component) return;",
    "",
    "  let Shell = null;",
    "  if (match.route.shellFile) {",
    "    const shellKey = findModuleKey(shellModules, match.route.shellFile);",
    "    if (shellKey) {",
    "      const shellMod = await shellModules[shellKey]();",
    "      Shell = shellMod.Shell;",
    "    }",
    "  }",
    "",
    "  const Component = routeMod.Component;",
    "  const props = { data: state.data, params: match.params };",
    "  const componentTree = Shell",
    "    ? h(Shell, null, h(Component, props))",
    "    : h(Component, props);",
    "  const tree = h(ViactRuntimeProvider, { data: state.data }, componentTree);",
    "",
    '  hydrate(tree, document.getElementById("viact-root"));',
    "}",
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
    "main();",
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
