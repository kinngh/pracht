# Functionality And DX Audit

Date: 2026-04-06

## Verdict

The core idea makes sense. The routing model, build pipeline, and deploy-target story are coherent enough that the project feels real, not just conceptual.

What does not fully make sense yet is the boundary between "implemented" and "documented" behavior. The happy path works, but several important framework promises either break in real usage or are documented more strongly than the runtime currently supports.

Current overall assessment:

1. Framework concept: `8/10`
2. Happy-path functionality: `7/10`
3. Edge-case/runtime correctness: `4/10`
4. Contributor DX: `6/10`
5. New-user DX: `3/10`

## What I Validated

Commands run:

1. `pnpm typecheck` -> failed
2. `pnpm test` -> passed, but with duplicated test discovery through workspace-linked `node_modules`
3. `pnpm build:example` -> passed
4. `pnpm e2e` -> passed on the suite I ran
5. `pnpm playwright test e2e/vercel-build.test.ts` -> passed
6. `pnpm dev:example` -> started successfully at `http://localhost:3000`
7. `pnpm preview:example 4173` -> started successfully

Manual product checks in preview:

1. Home page rendered correctly
2. Pricing page rendered correctly
3. Auth redirect from `/dashboard` worked without a cookie
4. Authenticated `/dashboard` rendered correctly
5. Direct authenticated load of `/settings` produced a blank page with a browser error
6. Submitting the dashboard form navigated the browser to raw JSON instead of behaving like an enhanced framework form

## Main Findings

### 1. Critical: Direct SPA route loads are broken

Files:

1. `packages/framework/src/runtime.ts:247-283`
2. `packages/framework/src/router.ts:145-150`
3. `examples/basic/src/routes/settings.tsx:9-18`

Why this matters:

1. `render: "spa"` routes return HTML with an empty `#viact-root` and `window.__VIACT_STATE__.data = null`.
2. The client router then hydrates immediately from that null state instead of first fetching route data.
3. The example SPA route expects `data.sections.map(...)`, so a direct authenticated load of `/settings` breaks.

Observed behavior:

1. Opening `http://localhost:4173/settings` with a valid session cookie produced a blank page.
2. The browser console showed `Uncaught (in promise)`.
3. `curl --cookie "session=abc123" http://localhost:4173/settings` returned HTML containing:

```html
<div id="viact-root"></div>
<script>
  window.__VIACT_STATE__ = { url: "/settings", routeId: "settings", data: null };
</script>
```

This is a real end-user breakage, not just a docs mismatch.

### 2. Critical: `<Form>` and action DX do not match the framework contract

Files:

1. `packages/framework/src/runtime.ts:110-128`
2. `packages/framework/src/runtime.ts:233-245`
3. `docs/DATA_LOADING.md:93-120`
4. `docs/DATA_LOADING.md:181-201`

Why this matters:

1. `<Form>` is currently just a plain `form` wrapper.
2. Action results are always JSON-serialized.
3. Redirects, response headers, and revalidation hints are not turned into actual runtime behavior.
4. The docs promise fetch interception, revalidation, same-origin CSRF protection, and progressive enhancement semantics that are not implemented.

Observed behavior:

1. On authenticated `/dashboard`, clicking `Revalidate dashboard` navigated the browser away from the app to raw JSON:

```json
{ "data": { "saved": true }, "ok": true, "revalidate": ["route:self"] }
```

This is one of the most important framework-level UX paths, and it currently behaves like an unintegrated primitive.

### 3. Critical: `create-viact` scaffolds apps that call `viact`, but does not install the package that provides the `viact` binary

Files:

1. `packages/start/src/index.js:229-261`
2. `packages/cli/package.json:5-10`

Why this matters:

1. Generated scripts are `viact dev`, `viact build`, and `viact preview`.
2. The scaffold adds `viact`, the adapter package, and `@viact/vite-plugin`, but not `@viact/cli`.
3. The `viact` binary is defined by `@viact/cli`, not by the `viact` framework package.

As written, a newly scaffolded app is not runnable from its own dependencies.

### 4. High: The repo-level quality gate is broken because `pnpm typecheck` fails

Files:

1. `packages/adapter-vercel/src/index.ts:48-50`
2. `package.json:7-10`

Observed behavior:

```text
packages/adapter-vercel/src/index.ts(50,10): error TS2352
```

Why this matters:

1. `package.json` defines `check` as `pnpm build && pnpm typecheck && pnpm test`.
2. That means the project's main validation workflow is red even though most visible runtime paths work.
3. This reduces trust in CI and makes it unclear what "green" means for contributors.

### 5. High: API routes do not use middleware even though the docs say they do

Files:

1. `packages/framework/src/runtime.ts:135-170`
2. `docs/WORKSPACE.md:22-27`
3. `docs/DATA_LOADING.md:230-235`
4. `VISION_MVP.md:69`

Why this matters:

1. `handleViactRequest()` dispatches API routes before route matching and before any middleware chain.
2. There is no API middleware resolution path in the current runtime.
3. The docs explicitly say API routes share middleware behavior.

That is a functionality gap and a documentation trust problem.

### 6. Medium: The action contract is only partially implemented

Files:

1. `packages/framework/src/types.ts:178-186`
2. `packages/framework/src/runtime.ts:233-245`
3. `docs/DATA_LOADING.md:97-119`

What is missing:

1. `{ redirect: "/path" }` is returned as JSON, not as an HTTP redirect
2. `{ headers }` is ignored
3. `revalidate` hints are ignored by the runtime
4. Documented same-origin/CSRF protection is not present

These are important because the type surface and docs suggest a more complete framework abstraction than users actually get.

### 7. Medium: The Node adapter is less complete than the docs imply

Files:

1. `packages/adapter-node/src/index.ts:40-116`
2. `packages/adapter-node/src/index.ts:142-158`
3. `docs/ADAPTERS.md:65-73`
4. `docs/WORKSPACE.md:62-64`

Notes:

1. The adapter does ISG cache serving and delegates everything else to `handleViactRequest()`.
2. It does not implement the full documented static-file serving flow.
3. `createNodeServerEntryModule()` creates a very thin server with `createNodeRequestHandler({ app })`, omitting registry, api routes, static dir, asset URLs, and manifest wiring.

The adapter package currently looks more like a partial building block than a complete documented production adapter.

### 8. High: Example usage docs are misleading

Files:

1. `examples/basic/README.md:7-12`
2. `examples/basic/package.json:1-17`

Observed behavior:

1. The README says to use `pnpm viact dev`, `pnpm viact build`, and `pnpm viact preview`.
2. Running those commands from `examples/basic/` fails because that package does not provide a `viact` command.

Verified result:

```text
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "viact" not found
```

This is a first-run DX paper cut right at the example entrypoint.

### 9. Medium: Test coverage misses some of the most important broken paths

Files:

1. `e2e/basic.test.ts:80-94`
2. `e2e/basic.test.ts:127-284`
3. `vitest.config.ts:3-6`

Gaps:

1. The SPA test only checks that the initial HTML is empty, not that a direct SPA load hydrates successfully.
2. There is no E2E test for submitting `<Form>` and staying inside the app.
3. There is no coverage for action redirects, headers, CSRF behavior, `useSubmitAction()`, or `useRevalidateRoute()`.
4. `pnpm test` currently re-runs router tests from workspace-linked `node_modules`, which is noisy and makes the unit test signal less clean than it should be.

## What Already Works Well

1. The explicit manifest model is good. `defineApp()`, `group()`, and `route()` are easy to reason about.
2. `pnpm build:example` works and produces believable build output for client, server, prerendered pages, and deploy-target metadata.
3. `pnpm dev:example` now starts without special local flags.
4. The example app is small but covers a meaningful slice of the framework surface.
5. Cloudflare and Vercel build outputs both exist and are exercised by tests.
6. The docs are thoughtful and architecture-first, even where they currently overstate shipped behavior.

## Does Everything Make Sense?

Mostly at the architecture level, not fully at the product level.

What makes sense:

1. Preact-first + Vite-native is coherent.
2. Explicit route manifest plus file-backed modules is a strong tradeoff.
3. Per-route render modes are understandable.
4. Adapter-based deployment targets are the right boundary.

What does not fully make sense yet:

1. The project presents some framework contracts as finished when they are still partial.
2. The example and scaffold, which should be the strongest DX surfaces, both have avoidable command-path issues.
3. The most "framework-like" interactions, SPA first load and enhanced forms, are exactly where the runtime is weakest.

## Recommended Fix Order

1. Fix SPA first-load hydration for `render: "spa"` routes.
2. Implement real form/action behavior or narrow the docs immediately.
3. Fix `create-viact` to install `@viact/cli` and validate generated apps end-to-end.
4. Make `pnpm check` green by fixing the Vercel type error.
5. Either implement API-route middleware or remove the claim from docs until it exists.
6. Fix `examples/basic/README.md` so commands work exactly as written.
7. Add E2E coverage for direct SPA loads and form submissions.

## Bottom Line

Viact already has a credible framework shape and a working happy path. It is not nonsense, and a lot of the design does make sense.

The current problem is trust: users can believe the docs, the types, or the example, but not always all three at once. Closing that gap would move this from an impressive prototype toward a framework people could actually rely on.
