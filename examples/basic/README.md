# Basic Example

This example is wired to Viact's Cloudflare build target.

## Commands

- `pnpm viact dev` starts the app with the regular Viact/Vite development server.
- `pnpm viact build` creates:
  - `dist/client/` for static assets and prerendered HTML
  - `dist/server/server.js` as the Worker bundle
  - `dist/server/wrangler.json` as a deployable Wrangler config
- `pnpm viact preview` previews the production build locally.

## Deploy

After building, deploy the generated Worker with:

```bash
pnpm dlx wrangler deploy --config dist/server/wrangler.json
```
