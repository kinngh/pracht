---
"@pracht/core": patch
"@pracht/adapter-node": patch
"@pracht/cli": patch
---

Separate HTML and route-state cache variants across framework responses and build outputs.

Page responses now vary on `x-pracht-route-state-request`, framework-generated
route-state responses default to `Cache-Control: no-store`, and Node/preview
cached HTML paths no longer intercept route-state fetches. Vercel build output
now routes route-state requests to the edge function before static rewrites.
