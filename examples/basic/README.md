# Basic Example

This example uses the Node adapter by default. Set `PRACHT_ADAPTER=vercel`
before building to emit Vercel's `.vercel/output/` directory instead.

## Commands

- `pnpm pracht dev` starts the app with the regular Pracht/Vite development server.
- `pnpm pracht build` creates:
  - `dist/client/` for static assets and prerendered HTML
  - `dist/server/server.js` as the server bundle
- `pnpm pracht preview` previews the production build locally.
