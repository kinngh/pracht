#!/usr/bin/env node

import { createServer as createHttpServer } from "node:http";
import { resolve, join, dirname, extname, relative, basename } from "node:path";
import {
  existsSync,
  statSync,
  mkdirSync,
  writeFileSync,
  createReadStream,
  readFileSync,
  rmSync,
  cpSync,
  readdirSync,
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
const PROJECT_DEFAULTS = {
  apiDir: "/src/api",
  appFile: "/src/routes.ts",
  middlewareDir: "/src/middleware",
  pagesDefaultRender: "ssr",
  pagesDir: "",
  routesDir: "/src/routes",
  serverDir: "/src/server",
  shellsDir: "/src/shells",
};
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const argv = process.argv.slice(2);
const command = argv[0];
const jsonOutput = argv.includes("--json");

if (!command || command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log(VERSION);
  process.exit(0);
}

const handlers = { build, dev, doctor, generate, preview };

if (!(command in handlers)) {
  handleCliError(new Error(`Unknown pracht command: ${command}`), { json: false });
}

handlers[command](argv.slice(1)).catch((error) => {
  handleCliError(error, { json: jsonOutput });
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function dev(args) {
  const options = parseFlags(args);
  const port = parseInt(process.env.PORT || options._[0] || "3000", 10);

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

async function preview(args) {
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

  const MIME_TYPES = {
    ".css": "text/css",
    ".html": "text/html",
    ".jpg": "image/jpeg",
    ".js": "application/javascript",
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
                mkdirSync(dirname(htmlPath), { recursive: true });
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

async function generate(args) {
  const [kind, ...rest] = args;
  if (!kind || kind === "--help" || kind === "-h") {
    printGenerateHelp();
    return;
  }

  const options = parseFlags(rest);
  const project = readProjectConfig(process.cwd());
  const result = runGenerate(kind, options, project);

  if (options.json) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  console.log(`Created ${result.kind}:`);
  for (const file of result.created) {
    console.log(`  ${file}`);
  }
  for (const file of result.updated) {
    console.log(`  updated ${file}`);
  }
}

async function doctor(args) {
  const options = parseFlags(args);
  const report = runDoctor(process.cwd());

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Pracht doctor (${report.mode} mode)`);
    for (const check of report.checks) {
      console.log(`${check.status.toUpperCase().padEnd(5)} ${check.message}`);
    }
    console.log(report.ok ? "\nNo blocking issues found." : "\nBlocking issues found.");
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`pracht ${VERSION}

Usage:
  pracht dev [port]                 Start development server with HMR
  pracht build                      Production build (client + server)
  pracht preview [port]             Preview the production build
  pracht generate <kind> [flags]    Scaffold framework files
  pracht doctor [--json]            Validate app wiring

Generate kinds:
  route       --path /dashboard [--render ssr|spa|ssg|isg] [--shell app] [--middleware auth] [--loader]
  shell       --name app
  middleware  --name auth
  api         --path /health [--methods GET,POST]
`);
}

function printGenerateHelp() {
  console.log(`Usage:
  pracht generate route --path /dashboard [--render ssr|spa|ssg|isg] [--shell app] [--middleware auth] [--loader] [--json]
  pracht generate shell --name app [--json]
  pracht generate middleware --name auth [--json]
  pracht generate api --path /health [--methods GET,POST] [--json]
`);
}

// ---------------------------------------------------------------------------
// Generate helpers
// ---------------------------------------------------------------------------

function runGenerate(kind, options, project) {
  if (kind === "route") {
    return generateRoute(options, project);
  }
  if (kind === "shell") {
    return generateShell(options, project);
  }
  if (kind === "middleware") {
    return generateMiddleware(options, project);
  }
  if (kind === "api") {
    return generateApi(options, project);
  }

  throw new Error(`Unknown generate kind: ${kind}`);
}

function generateRoute(options, project) {
  const routePath = normalizeRoutePathString(requireStringOption(options, "path"));
  const render = requireEnumOption(options, "render", ["spa", "ssr", "ssg", "isg"], "ssr");
  const includeLoader = Boolean(options.loader);
  const includeErrorBoundary = Boolean(options["error-boundary"]);
  const middleware = parseCommaList(options.middleware);
  const includeStaticPaths =
    Boolean(options["static-paths"]) ||
    (hasDynamicSegments(routePath) && (render === "ssg" || render === "isg"));
  const title = requireOptionalString(options, "title") ?? titleFromPath(routePath);

  if (project.mode === "pages") {
    if (options.shell) {
      throw new Error("`pracht generate route --shell` is only available for manifest apps.");
    }
    if (middleware.length > 0) {
      throw new Error("`pracht generate route --middleware` is only available for manifest apps.");
    }
    return generatePagesRoute({
      includeErrorBoundary,
      includeLoader,
      includeStaticPaths,
      project,
      render,
      routePath,
      title,
    });
  }

  const manifestPath = resolveProjectPath(project.root, project.appFile);
  assertFileExists(manifestPath, `App manifest not found at ${project.appFile}.`);

  const manifestSource = readFileSync(manifestPath, "utf-8");
  const registeredShells = new Set(
    extractRegistryEntries(manifestSource, "shells").map((entry) => entry.name),
  );
  const registeredMiddleware = new Set(
    extractRegistryEntries(manifestSource, "middleware").map((entry) => entry.name),
  );

  const shellName = requireOptionalString(options, "shell");
  if (shellName && !registeredShells.has(shellName)) {
    throw new Error(`Shell "${shellName}" is not registered in ${project.appFile}.`);
  }

  for (const name of middleware) {
    if (!registeredMiddleware.has(name)) {
      throw new Error(`Middleware "${name}" is not registered in ${project.appFile}.`);
    }
  }

  const routeFile = resolveRouteModulePath(project, routePath, ".tsx");
  writeGeneratedFile(
    routeFile.absolutePath,
    buildManifestRouteModuleSource({
      includeErrorBoundary,
      includeLoader,
      includeStaticPaths,
      routePath,
      title,
    }),
  );

  let nextManifestSource = manifestSource;
  nextManifestSource = ensureCoreNamedImport(nextManifestSource, "route");
  if (render === "isg") {
    nextManifestSource = ensureCoreNamedImport(nextManifestSource, "timeRevalidate");
  }

  const routeModulePath = toManifestModulePath(manifestPath, routeFile.absolutePath);
  const routeId = routeIdFromPath(routePath);
  const meta = [`id: ${quote(routeId)}`, `render: ${quote(render)}`];

  if (shellName) {
    meta.push(`shell: ${quote(shellName)}`);
  }
  if (middleware.length > 0) {
    meta.push(`middleware: [${middleware.map((item) => quote(item)).join(", ")}]`);
  }
  if (render === "isg") {
    const seconds = requirePositiveIntegerOption(options, "revalidate", 3600);
    meta.push(`revalidate: timeRevalidate(${seconds})`);
  }

  nextManifestSource = insertArrayItem(
    nextManifestSource,
    "routes",
    [
      `route(${quote(routePath)}, ${quote(routeModulePath)}, {`,
      ...meta.map((line) => `  ${line},`),
      "})",
    ].join("\n"),
  );
  writeFileSync(manifestPath, ensureTrailingNewline(nextManifestSource), "utf-8");

  return {
    created: [displayPath(project.root, routeFile.absolutePath)],
    kind: "route",
    updated: [displayPath(project.root, manifestPath)],
  };
}

function generatePagesRoute({
  includeErrorBoundary,
  includeLoader,
  includeStaticPaths,
  project,
  render,
  routePath,
  title,
}) {
  const routeFile = resolvePagesRouteModulePath(project, routePath, ".tsx");
  writeGeneratedFile(
    routeFile.absolutePath,
    buildPagesRouteModuleSource({
      includeErrorBoundary,
      includeLoader,
      includeStaticPaths,
      render,
      routePath,
      title,
    }),
  );

  return {
    created: [displayPath(project.root, routeFile.absolutePath)],
    kind: "route",
    updated: [],
  };
}

function generateShell(options, project) {
  if (project.mode === "pages") {
    throw new Error(
      "Pages router apps use a single `_app` shell. `pracht generate shell` is only available for manifest apps.",
    );
  }

  const name = requireStringOption(options, "name");
  const manifestPath = resolveProjectPath(project.root, project.appFile);
  assertFileExists(manifestPath, `App manifest not found at ${project.appFile}.`);

  const shellFile = resolveScopedFile(project.root, project.shellsDir, `${name}.tsx`);
  writeGeneratedFile(shellFile, buildShellModuleSource(name));

  const manifestSource = readFileSync(manifestPath, "utf-8");
  const updatedSource = upsertObjectEntry(
    manifestSource,
    "shells",
    `${name}: ${quote(toManifestModulePath(manifestPath, shellFile))}`,
  );
  writeFileSync(manifestPath, ensureTrailingNewline(updatedSource), "utf-8");

  return {
    created: [displayPath(project.root, shellFile)],
    kind: "shell",
    updated: [displayPath(project.root, manifestPath)],
  };
}

function generateMiddleware(options, project) {
  if (project.mode === "pages") {
    throw new Error(
      "Pages router apps do not use manifest middleware registration. `pracht generate middleware` is only available for manifest apps.",
    );
  }

  const name = requireStringOption(options, "name");
  const manifestPath = resolveProjectPath(project.root, project.appFile);
  assertFileExists(manifestPath, `App manifest not found at ${project.appFile}.`);

  const middlewareFile = resolveScopedFile(project.root, project.middlewareDir, `${name}.ts`);
  writeGeneratedFile(middlewareFile, buildMiddlewareModuleSource());

  const manifestSource = readFileSync(manifestPath, "utf-8");
  const updatedSource = upsertObjectEntry(
    manifestSource,
    "middleware",
    `${name}: ${quote(toManifestModulePath(manifestPath, middlewareFile))}`,
  );
  writeFileSync(manifestPath, ensureTrailingNewline(updatedSource), "utf-8");

  return {
    created: [displayPath(project.root, middlewareFile)],
    kind: "middleware",
    updated: [displayPath(project.root, manifestPath)],
  };
}

function generateApi(options, project) {
  const endpointPath = normalizeApiPath(requireStringOption(options, "path"));
  const methods = parseApiMethods(options.methods);
  const apiFile = resolveApiModulePath(project, endpointPath);
  writeGeneratedFile(apiFile.absolutePath, buildApiRouteSource({ endpointPath, methods }));

  return {
    created: [displayPath(project.root, apiFile.absolutePath)],
    kind: "api",
    updated: [],
  };
}

function buildManifestRouteModuleSource({
  includeErrorBoundary,
  includeLoader,
  includeStaticPaths,
  routePath,
  title,
}) {
  const params = dynamicParamNames(routePath);
  const imports = [];
  const sections = [];

  if (includeLoader) {
    imports.push("LoaderArgs", "RouteComponentProps");
  }
  if (includeErrorBoundary) {
    imports.push("ErrorBoundaryProps");
  }

  if (imports.length > 0) {
    sections.push(`import type { ${imports.join(", ")} } from "@pracht/core";`);
    sections.push("");
  }

  if (includeLoader) {
    sections.push(
      "export async function loader(_args: LoaderArgs) {",
      `  return { message: ${quote(`Welcome to ${title}.`)} };`,
      "}",
      "",
    );
  }

  if (includeStaticPaths) {
    sections.push(
      "export function getStaticPaths() {",
      `  return [${buildStaticPathsStub(params)}];`,
      "}",
      "",
    );
  }

  sections.push("export function head() {", `  return { title: ${quote(title)} };`, "}", "");

  if (includeLoader) {
    sections.push(
      "export function Component({ data }: RouteComponentProps<typeof loader>) {",
      "  return (",
      "    <section>",
      `      <h1>${escapeJsxText(title)}</h1>`,
      "      <p>{data.message}</p>",
      "    </section>",
      "  );",
      "}",
    );
  } else {
    sections.push(
      "export function Component() {",
      "  return (",
      "    <section>",
      `      <h1>${escapeJsxText(title)}</h1>`,
      "    </section>",
      "  );",
      "}",
    );
  }

  if (includeErrorBoundary) {
    sections.push(
      "",
      "export function ErrorBoundary({ error }: ErrorBoundaryProps) {",
      "  return <p>{error.message}</p>;",
      "}",
    );
  }

  return `${sections.join("\n")}\n`;
}

function buildPagesRouteModuleSource({
  includeErrorBoundary,
  includeLoader,
  includeStaticPaths,
  render,
  routePath,
  title,
}) {
  const params = dynamicParamNames(routePath);
  const imports = [];
  const sections = [];

  if (includeLoader) {
    imports.push("LoaderArgs", "RouteComponentProps");
  }
  if (includeErrorBoundary) {
    imports.push("ErrorBoundaryProps");
  }

  if (imports.length > 0) {
    sections.push(`import type { ${imports.join(", ")} } from "@pracht/core";`);
    sections.push("");
  }

  sections.push(`export const RENDER_MODE = ${quote(render)};`, "");

  if (includeLoader) {
    sections.push(
      "export async function loader(_args: LoaderArgs) {",
      `  return { message: ${quote(`Welcome to ${title}.`)} };`,
      "}",
      "",
    );
  }

  if (includeStaticPaths) {
    sections.push(
      "export function getStaticPaths() {",
      `  return [${buildStaticPathsStub(params)}];`,
      "}",
      "",
    );
  }

  if (includeLoader) {
    sections.push(
      "export function Component({ data }: RouteComponentProps<typeof loader>) {",
      "  return (",
      "    <section>",
      `      <h1>${escapeJsxText(title)}</h1>`,
      "      <p>{data.message}</p>",
      "    </section>",
      "  );",
      "}",
    );
  } else {
    sections.push(
      "export function Component() {",
      "  return (",
      "    <section>",
      `      <h1>${escapeJsxText(title)}</h1>`,
      "    </section>",
      "  );",
      "}",
    );
  }

  if (includeErrorBoundary) {
    sections.push(
      "",
      "export function ErrorBoundary({ error }: ErrorBoundaryProps) {",
      "  return <p>{error.message}</p>;",
      "}",
    );
  }

  return `${sections.join("\n")}\n`;
}

function buildShellModuleSource(name) {
  const title = titleCase(name);
  return [
    'import type { ShellProps } from "@pracht/core";',
    "",
    "export function Shell({ children }: ShellProps) {",
    "  return (",
    `    <div class=${quote(`${name}-shell`)}>`,
    "      <main>{children}</main>",
    "    </div>",
    "  );",
    "}",
    "",
    "export function head() {",
    `  return { title: ${quote(title)} };`,
    "}",
    "",
  ].join("\n");
}

function buildMiddlewareModuleSource() {
  return [
    'import type { MiddlewareFn } from "@pracht/core";',
    "",
    "export const middleware: MiddlewareFn = async (_args) => {",
    "  return;",
    "};",
    "",
  ].join("\n");
}

function buildApiRouteSource({ endpointPath, methods }) {
  const methodLines = methods.flatMap((method, index) => {
    const lines = buildApiMethodSource(method, methods, endpointPath);
    if (index === methods.length - 1) return lines;
    return [...lines, ""];
  });

  return ['import type { BaseRouteArgs } from "@pracht/core";', "", ...methodLines, ""].join("\n");
}

function buildApiMethodSource(method, methods, endpointPath) {
  if (method === "DELETE" || method === "HEAD") {
    return [
      `export function ${method}(_args: BaseRouteArgs) {`,
      "  return new Response(null, { status: 204 });",
      "}",
    ];
  }

  if (method === "OPTIONS") {
    return [
      `export function ${method}(_args: BaseRouteArgs) {`,
      "  return new Response(null, {",
      `    headers: { allow: ${quote(methods.join(", "))} },`,
      "    status: 204,",
      "  });",
      "}",
    ];
  }

  if (method === "GET") {
    return [
      `export function ${method}(_args: BaseRouteArgs) {`,
      `  return Response.json({ endpoint: ${quote(`/api${endpointPath}`)}, ok: true });`,
      "}",
    ];
  }

  const status = method === "POST" ? 201 : 200;
  return [
    `export async function ${method}({ request }: BaseRouteArgs) {`,
    "  const body = await request.json();",
    `  return Response.json({ body, ok: true }, { status: ${status} });`,
    "}",
  ];
}

// ---------------------------------------------------------------------------
// Doctor helpers
// ---------------------------------------------------------------------------

function runDoctor(root) {
  const project = readProjectConfig(root);
  const checks = [];
  const configDisplayPath = project.configFile
    ? displayPath(root, project.configFile)
    : "vite.config.*";

  if (!project.configFile) {
    checks.push(createCheck("error", "Missing vite config."));
  } else {
    checks.push(createCheck("ok", `Found ${configDisplayPath}.`));
  }

  if (!project.hasPrachtPlugin) {
    checks.push(createCheck("error", "vite.config does not appear to register the pracht plugin."));
  } else {
    checks.push(createCheck("ok", "Vite config registers the pracht plugin."));
  }

  if (project.mode === "pages") {
    collectPagesDoctorChecks(project, checks);
  } else {
    collectManifestDoctorChecks(project, checks);
  }

  collectPackageDoctorChecks(project, checks);

  return {
    checks,
    configFile: project.configFile ? displayPath(root, project.configFile) : null,
    mode: project.mode,
    ok: !checks.some((check) => check.status === "error"),
  };
}

function collectManifestDoctorChecks(project, checks) {
  const manifestPath = resolveProjectPath(project.root, project.appFile);
  if (!existsSync(manifestPath)) {
    checks.push(createCheck("error", `App manifest is missing at ${project.appFile}.`));
    return;
  }

  checks.push(createCheck("ok", `Found app manifest at ${project.appFile}.`));

  const source = readFileSync(manifestPath, "utf-8");
  const routeCount = (source.match(/\broute\s*\(/g) ?? []).length;
  if (routeCount === 0) {
    checks.push(createCheck("warning", "No routes were found in the app manifest."));
  } else {
    checks.push(
      createCheck("ok", `App manifest defines ${routeCount} route${routeCount === 1 ? "" : "s"}.`),
    );
  }

  const shellEntries = extractRegistryEntries(source, "shells");
  const middlewareEntries = extractRegistryEntries(source, "middleware");
  if (shellEntries.length > 0) {
    checks.push(
      createCheck(
        "ok",
        `Registered ${shellEntries.length} shell${shellEntries.length === 1 ? "" : "s"}.`,
      ),
    );
  }
  if (middlewareEntries.length > 0) {
    checks.push(
      createCheck(
        "ok",
        `Registered ${middlewareEntries.length} middleware module${middlewareEntries.length === 1 ? "" : "s"}.`,
      ),
    );
  }

  const relativeModules = [...extractRelativeModulePaths(source)];
  const missingModules = relativeModules
    .map((modulePath) => ({
      display: modulePath,
      exists: existsSync(resolve(dirname(manifestPath), modulePath)),
    }))
    .filter((entry) => !entry.exists)
    .map((entry) => entry.display);

  if (missingModules.length > 0) {
    checks.push(
      createCheck(
        "error",
        `Manifest references missing files: ${missingModules.map((item) => quote(item)).join(", ")}.`,
      ),
    );
  } else {
    checks.push(
      createCheck(
        "ok",
        `All ${relativeModules.length} manifest module path${relativeModules.length === 1 ? "" : "s"} resolve.`,
      ),
    );
  }
}

function collectPagesDoctorChecks(project, checks) {
  const pagesDir = resolveProjectPath(project.root, project.pagesDir);
  if (!existsSync(pagesDir)) {
    checks.push(createCheck("error", `Pages directory is missing at ${project.pagesDir}.`));
    return;
  }

  checks.push(createCheck("ok", `Found pages directory at ${project.pagesDir}.`));

  const pageFiles = listFilesRecursively(pagesDir).filter((file) =>
    /\.(ts|tsx|js|jsx|md|mdx)$/.test(file),
  );
  const routeFiles = pageFiles.filter(
    (file) => basename(file) !== "_app.tsx" && basename(file) !== "_app.ts",
  );
  if (routeFiles.length === 0) {
    checks.push(createCheck("warning", "Pages router app does not contain any route files yet."));
  } else {
    checks.push(
      createCheck(
        "ok",
        `Found ${routeFiles.length} page route${routeFiles.length === 1 ? "" : "s"}.`,
      ),
    );
  }

  const hasAppShell = pageFiles.some((file) => /^_app\.(ts|tsx|js|jsx)$/.test(basename(file)));
  if (!hasAppShell) {
    checks.push(createCheck("warning", "No `_app` shell was found in the pages directory."));
  } else {
    checks.push(createCheck("ok", "Found a pages-router `_app` shell."));
  }
}

function collectPackageDoctorChecks(project, checks) {
  const packageJsonPath = resolve(project.root, "package.json");
  if (!existsSync(packageJsonPath)) {
    checks.push(createCheck("warning", "No package.json found in the current app root."));
    return;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  if (!("@pracht/cli" in deps)) {
    checks.push(
      createCheck("warning", "`@pracht/cli` is not listed in package.json dependencies."),
    );
  }

  const adapterPackages = Object.keys(deps).filter((name) => name.startsWith("@pracht/adapter-"));
  if (adapterPackages.length === 0) {
    checks.push(
      createCheck("warning", "No built-in pracht adapter dependency was found in package.json."),
    );
  } else {
    checks.push(
      createCheck(
        "ok",
        `Found adapter dependency ${adapterPackages.map((name) => quote(name)).join(", ")}.`,
      ),
    );
  }
}

function createCheck(status, message) {
  return { message, status };
}

// ---------------------------------------------------------------------------
// Project/config helpers
// ---------------------------------------------------------------------------

function readProjectConfig(root) {
  const configFile = findConfigFile(root);
  const rawConfig = configFile ? readFileSync(configFile, "utf-8") : "";
  const config = {
    ...PROJECT_DEFAULTS,
    configFile,
    hasPrachtPlugin: /\bpracht\s*\(/.test(rawConfig),
    rawConfig,
    root,
  };

  for (const key of Object.keys(PROJECT_DEFAULTS)) {
    const value = readQuotedConfigValue(rawConfig, key);
    if (typeof value === "string") {
      config[key] = normalizeConfigPath(value);
    }
  }

  config.mode = config.pagesDir ? "pages" : "manifest";
  return config;
}

function findConfigFile(root) {
  for (const name of [
    "vite.config.ts",
    "vite.config.mts",
    "vite.config.js",
    "vite.config.mjs",
    "vite.config.cjs",
    "vite.config.cts",
  ]) {
    const file = resolve(root, name);
    if (existsSync(file)) return file;
  }
  return null;
}

function readQuotedConfigValue(source, key) {
  if (!source) return null;
  const pattern = new RegExp(`${key}\\s*:\\s*(["'\\\`])([^"'\\\`]+)\\1`);
  const match = source.match(pattern);
  return match ? match[2] : null;
}

function normalizeConfigPath(value) {
  if (!value) return value;
  return value.startsWith("/") ? value : `/${value}`;
}

function resolveProjectPath(root, configPath) {
  return resolve(root, `.${configPath}`);
}

function resolveScopedFile(root, configDir, fileName) {
  return resolve(resolveProjectPath(root, configDir), fileName);
}

function resolveRouteModulePath(project, routePath, extension) {
  const segments = segmentsFromRoutePath(routePath);
  const relativePath =
    segments.length === 0 ? `index${extension}` : `${segments.join("/")}${extension}`;
  const absolutePath = resolve(resolveProjectPath(project.root, project.routesDir), relativePath);
  return { absolutePath, relativePath };
}

function resolvePagesRouteModulePath(project, routePath, extension) {
  const segments = segmentsFromRoutePath(routePath);
  const relativePath =
    segments.length === 0 ? `index${extension}` : `${segments.join("/")}${extension}`;
  const absolutePath = resolve(resolveProjectPath(project.root, project.pagesDir), relativePath);
  return { absolutePath, relativePath };
}

function resolveApiModulePath(project, endpointPath) {
  const segments = segmentsFromApiPath(endpointPath);
  const relativePath = segments.length === 0 ? "index.ts" : `${segments.join("/")}.ts`;
  const absolutePath = resolve(resolveProjectPath(project.root, project.apiDir), relativePath);
  return { absolutePath, relativePath };
}

function displayPath(root, filePath) {
  return relative(root, filePath) || ".";
}

function writeGeneratedFile(filePath, source) {
  if (existsSync(filePath)) {
    throw new Error(`Refusing to overwrite existing file ${filePath}.`);
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, ensureTrailingNewline(source), "utf-8");
}

function assertFileExists(filePath, message) {
  if (!existsSync(filePath)) {
    throw new Error(message);
  }
}

// ---------------------------------------------------------------------------
// Manifest editing helpers
// ---------------------------------------------------------------------------

function ensureCoreNamedImport(source, name) {
  const match = source.match(/import\s*\{([^}]+)\}\s*from\s*["']@pracht\/core["'];?/);
  if (!match) {
    return `import { ${name} } from "@pracht/core";\n${source}`;
  }

  const names = match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!names.includes(name)) {
    names.push(name);
  }

  return source.replace(match[0], `import { ${names.join(", ")} } from "@pracht/core";`);
}

function upsertObjectEntry(source, key, entry) {
  const property = findNamedBlock(source, key, "{", "}");
  if (!property) {
    const routesMatch = source.match(/^(\s*)routes\s*:/m);
    if (!routesMatch || routesMatch.index == null) {
      throw new Error(`Could not find a "${key}" or "routes" block in the app manifest.`);
    }

    const indent = routesMatch[1];
    const block = `${indent}${key}: {\n${indent}  ${entry},\n${indent}},\n`;
    return `${source.slice(0, routesMatch.index)}${block}${source.slice(routesMatch.index)}`;
  }

  return insertBlockEntry(source, property, entry);
}

function insertArrayItem(source, key, item) {
  const property = findNamedBlock(source, key, "[", "]");
  if (!property) {
    throw new Error(`Could not find "${key}" in the app manifest.`);
  }

  return insertBlockEntry(source, property, item);
}

function insertBlockEntry(source, block, entry) {
  const inner = source.slice(block.openIndex + 1, block.closeIndex);
  const closingIndent = block.indent;
  const childIndent = `${closingIndent}  `;
  const trimmed = inner.trim();

  if (!trimmed) {
    return `${source.slice(0, block.openIndex + 1)}\n${indentMultiline(entry, childIndent)}\n${closingIndent}${source.slice(block.closeIndex)}`;
  }

  const needsComma = !/[,[{(]\s*$/.test(inner) && !/,\s*$/.test(trimmed);
  const insertPrefix = needsComma ? "," : "";
  return `${source.slice(0, block.closeIndex)}${insertPrefix}\n${indentMultiline(entry, childIndent)}\n${closingIndent}${source.slice(block.closeIndex)}`;
}

function findNamedBlock(source, key, openChar, closeChar) {
  const pattern = new RegExp(`^([ \\t]*)${key}\\s*:\\s*\\${openChar}`, "m");
  const match = source.match(pattern);
  if (!match || match.index == null) {
    return null;
  }

  const openIndex = source.indexOf(openChar, match.index);
  const closeIndex = findMatchingDelimiter(source, openIndex, openChar, closeChar);
  return {
    closeIndex,
    indent: match[1],
    openIndex,
  };
}

function findMatchingDelimiter(source, openIndex, openChar, closeChar) {
  let depth = 0;
  let quoteChar = null;
  let escaping = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const current = source[index];
    if (quoteChar) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (current === "\\") {
        escaping = true;
        continue;
      }
      if (current === quoteChar) {
        quoteChar = null;
      }
      continue;
    }

    if (current === '"' || current === "'" || current === "`") {
      quoteChar = current;
      continue;
    }
    if (current === openChar) depth += 1;
    if (current === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error(`Could not find matching ${closeChar} for ${openChar}.`);
}

function indentMultiline(value, indent) {
  return value
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function toManifestModulePath(manifestPath, targetFilePath) {
  const relativePath = relative(dirname(manifestPath), targetFilePath).replaceAll("\\", "/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function extractRegistryEntries(source, key) {
  const block = findNamedBlock(source, key, "{", "}");
  if (!block) return [];
  const inner = source.slice(block.openIndex + 1, block.closeIndex);
  const entries = [];
  const pattern = /([A-Za-z0-9_-]+)\s*:\s*["'`]([^"'`]+)["'`]/g;

  for (const match of inner.matchAll(pattern)) {
    entries.push({ name: match[1], path: match[2] });
  }

  return entries;
}

function extractRelativeModulePaths(source) {
  const results = new Set();
  for (const match of source.matchAll(/["'`]((?:\.\.\/|\.\/)[^"'`]+)["'`]/g)) {
    results.add(match[1]);
  }
  return results;
}

// ---------------------------------------------------------------------------
// String/validation helpers
// ---------------------------------------------------------------------------

function parseFlags(args) {
  const options = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }

    if (token.startsWith("--no-")) {
      options[token.slice(5)] = false;
      continue;
    }

    const equalsIndex = token.indexOf("=");
    if (equalsIndex !== -1) {
      const key = token.slice(2, equalsIndex);
      const value = token.slice(equalsIndex + 1);
      assignOption(options, key, value);
      continue;
    }

    const key = token.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      assignOption(options, key, next);
      index += 1;
      continue;
    }

    assignOption(options, key, true);
  }

  return options;
}

function assignOption(options, key, value) {
  if (!(key in options)) {
    options[key] = value;
    return;
  }

  if (!Array.isArray(options[key])) {
    options[key] = [options[key]];
  }
  options[key].push(value);
}

function requireStringOption(options, key) {
  const value = requireOptionalString(options, key);
  if (!value) {
    throw new Error(`Missing required flag --${key}.`);
  }
  return value;
}

function requireOptionalString(options, key) {
  const value = options[key];
  if (Array.isArray(value)) {
    return String(value[value.length - 1]);
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function requireEnumOption(options, key, allowed, fallback) {
  const value = requireOptionalString(options, key) ?? fallback;
  if (!allowed.includes(value)) {
    throw new Error(`Invalid value for --${key}. Expected one of ${allowed.join(", ")}.`);
  }
  return value;
}

function requirePositiveIntegerOption(options, key, fallback) {
  const raw = requireOptionalString(options, key);
  const value = raw == null ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${key} must be a positive integer.`);
  }
  return value;
}

function parseCommaList(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseApiMethods(value) {
  const methods = parseCommaList(value);
  const normalized = methods.length === 0 ? ["GET"] : methods.map((entry) => entry.toUpperCase());

  for (const method of normalized) {
    if (!HTTP_METHODS.has(method)) {
      throw new Error(`Unsupported HTTP method "${method}".`);
    }
  }

  return [...new Set(normalized)];
}

function normalizeRoutePathString(value) {
  if (!value || value === "/") return "/";
  const normalized = `/${value}`.replace(/\/+/g, "/");
  return normalized !== "/" && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function normalizeApiPath(value) {
  const normalized = normalizeRoutePathString(value).replace(/^\/api(?=\/|$)/, "");
  return normalized || "/";
}

function hasDynamicSegments(routePath) {
  return routePath.split("/").some((segment) => segment.startsWith(":") || segment === "*");
}

function dynamicParamNames(routePath) {
  return routePath
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(":")) return segment.slice(1);
      if (segment === "*") return "slug";
      return null;
    })
    .filter(Boolean);
}

function segmentsFromRoutePath(routePath) {
  return routePath
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(":")) return `[${segment.slice(1)}]`;
      if (segment === "*") return "[...slug]";
      return segment;
    });
}

function segmentsFromApiPath(endpointPath) {
  return endpointPath
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(":")) return `[${segment.slice(1)}]`;
      if (segment === "*") return "[...slug]";
      return segment;
    });
}

function routeIdFromPath(routePath) {
  if (routePath === "/") return "index";
  return routePath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/^:/, "").replace(/\*/g, "splat"))
    .join("-");
}

function titleFromPath(routePath) {
  if (routePath === "/") return "Home";
  const lastSegment = routePath.split("/").filter(Boolean).at(-1) ?? "Page";
  return titleCase(lastSegment.replace(/^:/, "").replace(/\*/g, "slug"));
}

function titleCase(value) {
  return value
    .split(/[-_/]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function buildStaticPathsStub(params) {
  if (params.length === 0) {
    return "{}";
  }

  return `{ ${params.map((name) => `${name}: ${quote(`example-${name}`)}`).join(", ")} }`;
}

function quote(value) {
  return JSON.stringify(value);
}

function escapeJsxText(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function listFilesRecursively(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function handleCliError(error, { json }) {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error(message);
    if (error instanceof Error && error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Existing preview/build helpers
// ---------------------------------------------------------------------------

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
      dest: routeToStaticHtmlPath(route),
      src: routeToRouteExpression(route),
    });
  }

  for (const route of isgRoutes) {
    routes.push({
      dest: target,
      src: routeToRouteExpression(route),
    });
  }

  routes.push({ handle: "filesystem" });
  routes.push({ dest: target, src: "/(.*)" });

  return {
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
    routes,
    version: 3,
  };
}

function createVercelFunctionConfig({ regions }) {
  const config = {
    entrypoint: "server.js",
    runtime: "edge",
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
