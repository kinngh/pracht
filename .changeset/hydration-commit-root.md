---
"@pracht/core": patch
---

Two `useIsHydrated` correctness fixes:

1. **Mid-tree sibling race.** Sibling components rendered in the same hydrate
   call could disagree about whether hydration had finished because the global
   `_hydrated` flag was flipped from `options.diffed` (per vnode). The earlier
   sibling's `diffed` would fire before the later sibling's render, so the
   later sibling read `true` from `useState(_hydrated)` during its very first
   render. Moved the flip to `options._commit` (commit root), which fires once
   per commit after the whole tree has diffed. This also handles Suspense
   resolution transparently — when a lazy boundary settles, its re-render
   goes through a normal diff→commit cycle and `_commit` catches it at the
   end.

2. **Non-hydrating suspensions were counted as hydration-suspensions.**
   `options._catchError` was counting every thrown promise while the global
   `_hydrating` flag was true, so a parallel `render()` tree (portal, modal
   root, island) that suspended during the hydration window would pin
   `_hydrated` at `false` forever. The counter now only increments when the
   thrown promise originates from a vnode that actually carries
   `MODE_HYDRATE`, matching the check preact-suspense itself uses to decide
   whether to preserve server DOM.
