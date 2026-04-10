---
"@pracht/core": patch
---

Add structured runtime diagnostics to debug route-state, SSR, and API failures.

`handlePrachtRequest()` now catches middleware and API exceptions earlier in the
pipeline and, when `debugErrors: true` is enabled, serializes framework
diagnostics such as the failure phase, matched route metadata, and relevant
module files alongside the normalized error payload.
