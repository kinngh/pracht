---
"@pracht/core": patch
---

Normalize module paths once via `normalizeModulePath` instead of duplicating `./` and `/` stripping across manifest and registry lookups. Adds a cached suffix index for O(1) manifest resolution.
