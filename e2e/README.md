# E2E

Playwright coverage now exercises `examples/cloudflare` in the browser dev loop
plus the Cloudflare and Vercel deployment build outputs.

The first pass of the scaffold focuses on the shared package boundaries:

- `viact` for the manifest, routing, and runtime contracts
- `@viact/vite-plugin` for virtual module generation
- `@viact/adapter-node` for Node request/response bridging
- `@viact/adapter-cloudflare` for Cloudflare Worker output
- `@viact/adapter-vercel` for Vercel Build Output API output
- `@viact/cli` for the command surface
