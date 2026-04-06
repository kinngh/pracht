# Workspace Shape

This repo now has the first pass of the Phase 1 monorepo layout described in
`VISION_MVP.md`.

## Packages

| Path | Package | Current role |
|------|---------|--------------|
| `packages/framework` | `viact` | Core manifest API, route resolution, route matching, SSR rendering, client runtime |
| `packages/vite-plugin` | `@viact/vite-plugin` | Virtual modules, `import.meta.glob()` registries, dev SSR middleware |
| `packages/adapter-node` | `@viact/adapter-node` | Node `IncomingMessage`/`ServerResponse` bridge into `handleViactRequest()` |
| `packages/cli` | `@viact/cli` | `viact dev`, `build`, and `preview` backed by Vite |
| `examples/basic` | `@viact/example-basic` | Example app with SSG, ISG, SSR, and SPA routes plus auth middleware |

## What Exists Today

- **Route manifest** — `defineApp()`, `route()`, `group()`, `resolveApp()`, and
  `matchAppRoute()` are fully implemented with dynamic-segment and catch-all
  matching.
- **Server rendering** — `handleViactRequest()` executes the full request
  lifecycle: middleware chain → loader → Preact `renderToString` → HTML document
  assembly with hydration state (`window.__VIACT_STATE__`), head metadata
  merging, and client entry injection.
- **Render modes** — SSR, SSG, and ISG routes render server-side; SPA routes
  return a minimal shell with no SSR content; route-state JSON responses are
  returned when the `x-viact-route-state-request` header is present.
- **Middleware** — Named middleware from the manifest runs before loaders and can
  redirect, return a Response, or augment the context.
- **Actions** — POST/PUT/PATCH/DELETE requests are routed to the route module's
  `action` export and return JSON.
- **Vite plugin** — Generates `virtual:viact/client` (hydration entry) and
  `virtual:viact/server` (resolved app + module registry) virtual modules. The
  `configureServer` hook adds SSR middleware to the Vite dev server.
- **Client hydration** — The generated client module matches the current route,
  lazy-loads the route and shell modules via `import.meta.glob()`, and calls
  `hydrate()` from Preact.
- **CLI** — `viact dev` starts a Vite dev server with SSR, `viact build` runs
  client + server builds, and `viact preview` serves the production build with
  static-file fallback.
- **Node adapter** — Translates Node requests to Web `Request` objects and calls
  `handleViactRequest()`.
- **E2E tests** — Playwright tests cover SSR rendering, loader data, head
  metadata, middleware redirects, auth-gated routes, SPA mode, route-state JSON,
  404 handling, and hydration.

## Next Layer

The current loop is runnable end-to-end. The next priorities are:

1. Production build output verification — confirm the `viact build` + `viact
   preview` pipeline produces working client/server bundles.
2. Client-side navigation — implement the client router that intercepts link
   clicks, fetches route-state JSON, and updates the Preact tree without a full
   page reload.
3. SSG prerendering — run loaders and render static HTML to disk at build time
   for routes with `render: "ssg"`.
4. ISG revalidation — implement time-based revalidation in the Node adapter
   using file modification timestamps.
5. HMR — ensure route/shell/middleware module changes propagate via Vite's HMR
   without a full reload.
