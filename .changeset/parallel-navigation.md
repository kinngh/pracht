---
"@pracht/core": minor
---

Parallelize route-state fetch and module imports during client-side navigation. Route and shell chunks now start loading at the same time as the data fetch instead of waiting for it to complete. Prefetching also warms module imports alongside route-state data. Shell modules are cached to avoid re-importing on repeated navigations.
