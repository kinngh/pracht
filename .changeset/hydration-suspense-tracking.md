---
"@pracht/core": minor
---

Add `useIsHydrated` hook that tracks in-flight Suspense boundaries during hydration and returns `true` only after the initial hydration (including all suspended promises) has fully resolved.
