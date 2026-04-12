---
"@pracht/core": patch
"@pracht/adapter-node": patch
---

Performance optimizations for SSR runtime and Node adapter

- Cache `preact-render-to-string` dynamic import to avoid repeated async resolution per request
- Replace O(n) suffix matching in module registry and CSS/JS manifest lookups with pre-built WeakMap indexes for O(1) resolution
- Parallelize SSG prerendering with batched concurrency (10 pages at a time)
- Switch Node adapter from sync fs operations (statSync, writeFileSync, existsSync) to async equivalents to avoid blocking the event loop
- Reduce Response object allocations by combining security and route header application into a single pass
