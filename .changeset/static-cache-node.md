---
"@pracht/adapter-node": minor
"@pracht/cli": patch
---

Serve static assets directly from the Node adapter with proper Cache-Control headers. Hashed assets under /assets/ get immutable caching; HTML gets must-revalidate. Preview server now mirrors production caching behavior.
