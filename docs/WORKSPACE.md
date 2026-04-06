# Workspace Shape

This repo implements Phase 1 and Phase 2 (core) of the monorepo layout
described in `VISION_MVP.md`.

## Packages

| Path | Package | Current role |
|------|---------|--------------|
| `packages/framework` | `viact` | Core manifest API, route resolution, API routes, SSR rendering, client runtime |
| `packages/vite-plugin` | `@viact/vite-plugin` | Virtual modules, `import.meta.glob()` registries, API route auto-discovery, HMR, dev SSR middleware |
| `packages/adapter-node` | `@viact/adapter-node` | Node `IncomingMessage`/`ServerResponse` bridge, ISG stale-while-revalidate |
| `packages/adapter-cloudflare` | `@viact/adapter-cloudflare` | Cloudflare Workers adapter |
| `packages/cli` | `@viact/cli` | `viact dev`, `build` (with ISG manifest), and `preview` (with ISG revalidation) |
| `examples/basic` | `@viact/example-basic` | Example app with SSG, ISG, SSR, SPA routes, auth middleware, and API routes |

## What Exists Today

- **Route manifest** — `defineApp()`, `route()`, `group()`, `resolveApp()`, and
  `matchAppRoute()` are fully implemented with dynamic-segment and catch-all
  matching.
- **API routes** — File-based auto-discovery from `src/api/`. Files are globbed
  by the Vite plugin and resolved to URL paths (e.g. `src/api/health.ts` →
  `/api/health`, `src/api/users/[id].ts` → `/api/users/:id`). Modules export
  named HTTP method handlers (`GET`, `POST`, etc.) that return `Response`
  objects directly. API routes are dispatched before page routes in
  `handleViactRequest()`. Missing method handlers return 405.
- **Server rendering** — `handleViactRequest()` executes the full request
  lifecycle: API route check → middleware chain → loader → Preact
  `renderToString` → HTML document assembly with hydration state
  (`window.__VIACT_STATE__`), head metadata merging, and client entry injection.
- **Render modes** — SSR, SSG, and ISG routes render server-side; SPA routes
  return a minimal shell with no SSR content; route-state JSON responses are
  returned when the `x-viact-route-state-request` header is present.
- **ISG revalidation** — At build time, ISG routes are prerendered alongside SSG
  routes and an `isg-manifest.json` is generated mapping paths to revalidation
  config. At runtime, the Node adapter and CLI preview server implement
  stale-while-revalidate: cached HTML is served immediately, and if the file's
  mtime exceeds the `revalidate.seconds` threshold, background regeneration
  refreshes the cached page.
- **Middleware** — Named middleware from the manifest runs before loaders and can
  redirect, return a Response, or augment the context.
- **Actions** — POST/PUT/PATCH/DELETE requests are routed to the route module's
  `action` export and return JSON.
- **Vite plugin** — Generates `virtual:viact/client` (hydration entry) and
  `virtual:viact/server` (resolved app + module registry + API routes) virtual
  modules. The `configureServer` hook adds SSR middleware to the Vite dev
  server. The `handleHotUpdate` hook invalidates virtual modules when
  route/shell/middleware/API files change and triggers full reload when the
  app manifest (`src/routes.ts`) changes.
- **Client hydration** — The generated client module matches the current route,
  lazy-loads the route and shell modules via `import.meta.glob()`, and calls
  `hydrate()` from Preact.
- **CLI** — `viact dev` starts a Vite dev server with SSR, `viact build` runs
  client + server builds (with Vite manifest generation, SSG/ISG prerendering,
  and ISG manifest), and `viact preview` serves the production build with
  static-file fallback and ISG revalidation.
- **Package builds** — `tsdown` compiles `viact`, `@viact/vite-plugin`,
  `@viact/adapter-node`, and `@viact/adapter-cloudflare` from TypeScript to
  ESM (`dist/index.mjs` + `.d.mts`). The CLI remains plain JS.
- **Node adapter** — Translates Node requests to Web `Request` objects, calls
  `handleViactRequest()`, and implements ISG stale-while-revalidate with
  background regeneration.
- **E2E tests** — Playwright tests cover SSR rendering, loader data, head
  metadata, middleware redirects, auth-gated routes, SPA mode, route-state JSON,
  404 handling, hydration, client-side navigation, and API routes (GET, POST,
  405, 404).
- **Custom Vite plugins** — Users bring their own Vite plugins (MDX, Tailwind,
  image tools, PWA, etc.) alongside `viact()` in `vite.config.ts`. No special
  integration required — plugins participate in the full Vite pipeline for both
  client and SSR builds.

## Later (Phase 2 remaining)

1. `adapter-vercel` — Serverless / Edge functions, Build Output API v3.
2. ISG webhook revalidation — on-demand cache invalidation via POST endpoint.
3. `create-viact` — Starter CLI for scaffolding new projects.
4. Claude Code skills — Scaffolding, debugging, and deployment skills.
