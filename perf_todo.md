# Performance TODO

## P0 — Quick wins

- [ ] **Static import `preact-render-to-string`** — `runtime.ts:564,523` dynamically imports on every request. The module cache avoids re-evaluation but the async hop + promise resolution is unnecessary overhead. Import statically at module level.

- [ ] **Async fs ops in Node adapter hot paths** — `adapter-node/src/index.ts:151-153,212-213,240,469,495` uses `existsSync`, `statSync`, `writeFileSync` which block the event loop. Switch to `stat`/`writeFile` from `node:fs/promises`. The `writeFileSync` in `regenerateISGPage` (line 240) is especially bad — it blocks during what's supposed to be background regeneration.

## P1 — High impact, moderate effort

- [ ] **Module registry suffix index** — `runtime.ts:1043-1063` falls back to O(n) key iteration with string suffix matching on every module lookup. Called 4-6 times per request (route, shell, middleware(s), data, API). Pre-build a `Map<suffix, key>` at startup for O(1) lookups.

- [ ] **CSS/JS manifest suffix index** — `runtime.ts:621-643,645-667` does the same O(n) `Object.entries()` scan for CSS and JS resolution per request. Same fix as the registry: build a lookup map once.

- [ ] **Parallel SSG prerendering** — `runtime.ts:1285-1316` renders pages sequentially with `await` in a loop. Use `Promise.all` with a concurrency limiter (batches of ~10) for 5-10x faster builds.

## P2 — Moderate impact

- [ ] **Avoid double Response wrapping** — `runtime.ts:1183-1190,1192-1208` creates two new `Response` objects per page request (security headers + route headers). Combine into a single pass or mutate headers in place.

- [ ] **Stream static files in Node adapter** — `adapter-node/src/index.ts:430-431` buffers entire response body via `response.arrayBuffer()` before writing. For static files, pipe `fs.createReadStream` directly to `res`.

- [ ] **Prefetch cache cleanup** — `prefetch.ts:8,20-21` evicts stale entries only on access. The `prefetchCache` Map can grow unbounded. Add periodic cleanup or cap the map size.

## P3 — Larger lifts

- [ ] **Streaming SSR** — Currently buffers entire HTML via `renderToStringAsync` before sending. `preact-render-to-string` supports `renderToReadableStream`. Sending `<head>` + CSS links before body completes would improve TTFB on slow pages.

- [ ] **SSG loader deduplication** — No memoization during prerendering. If 50 pages share the same loader, it runs 50 times. Add a request-scoped cache keyed by loader file + params during `prerenderApp`.

- [ ] **Radix trie for route matching** — `app.ts:126-146` does linear scan through all routes. Fine for <20 routes, but O(routes x segments) per request at scale. A radix trie would make matching O(path length).
