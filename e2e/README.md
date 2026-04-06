# E2E

Playwright coverage now exercises both the browser dev loop and the Cloudflare
build output.

The first pass of the scaffold focuses on the shared package boundaries:

- `viact` for the manifest, routing, and runtime contracts
- `@viact/vite-plugin` for virtual module generation
- `@viact/adapter-node` for Node request/response bridging
- `@viact/adapter-cloudflare` for Cloudflare Worker output
- `@viact/cli` for the command surface
