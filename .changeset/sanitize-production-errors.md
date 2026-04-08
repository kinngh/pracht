---
"@pracht/core": patch
"@pracht/vite-plugin": patch
---

Sanitize unexpected 5xx route errors by default in SSR HTML, route-state JSON,
and hydration payloads while preserving explicit `PrachtHttpError` 4xx
messages. Add a `debugErrors` escape hatch for intentional local debugging and
ensure the Vite dev server keeps verbose errors enabled.
