---
"@pracht/adapter-cloudflare": patch
"@pracht/cli": patch
---

Apply default security headers to static asset responses across adapters

Cloudflare static assets now inherit the same permissions-policy, referrer-policy, x-content-type-options, and x-frame-options headers that dynamic responses already receive. Vercel build output config now emits a headers section so static files served by Vercel's CDN also get the baseline security headers.
