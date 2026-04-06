# Viact Deploy

Guided adapter setup and deployment for viact applications.

## Instructions

You are helping deploy a **viact** application. Guide the user through adapter configuration, building, and deploying to their target platform.

### Supported adapters

| Adapter | Package | Status |
|---------|---------|--------|
| Node.js | `@viact/adapter-node` | Stable |
| Cloudflare Workers | `@viact/adapter-cloudflare` | Stable |
| Vercel | — | Planned |

### Step 1: Determine the target

Ask the user where they want to deploy if not already clear from their message. Then proceed with the appropriate adapter guide below.

---

### Node.js deployment

#### Setup

1. Ensure `@viact/adapter-node` is installed (check `package.json`).
2. In `vite.config.ts`, set the adapter:
   ```ts
   import { viact } from "@viact/vite-plugin";

   export default {
     plugins: [viact({ adapter: "node" })],
   };
   ```
3. The default adapter is `"node"`, so this may already be configured.

#### Build

```bash
viact build
# or: node --experimental-strip-types packages/cli/bin/viact.js build
```

This produces:
- `dist/client/` — static assets (JS, CSS, prerendered HTML)
- `dist/server/server.js` — Node server entry
- `dist/client/viact-isg-manifest.json` — ISG revalidation config (if ISG routes exist)
- `dist/client/.vite/manifest.json` — asset manifest for script/style injection

#### Run

```bash
node dist/server/server.js
```

The server listens on port 3000 by default. For production:
- Put behind a reverse proxy (nginx, Caddy) for TLS and compression.
- Use a process manager (PM2, systemd) for restarts.
- Set `NODE_ENV=production`.

#### Preview locally

```bash
viact preview
```

This serves the production build with ISG revalidation support.

#### Docker example

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY dist/ dist/
COPY package.json .
EXPOSE 3000
CMD ["node", "dist/server/server.js"]
```

---

### Cloudflare Workers deployment

#### Setup

1. Ensure `@viact/adapter-cloudflare` is installed (check `package.json`).
2. In `vite.config.ts`, set the adapter:
   ```ts
   import { viact } from "@viact/vite-plugin";

   export default {
     plugins: [viact({ adapter: "cloudflare" })],
   };
   ```

#### Build

```bash
viact build
```

This produces:
- `dist/client/` — static assets served via the `ASSETS` binding
- `dist/server/server.js` — Worker entry module (ESM `export default { fetch }`)

#### Wrangler configuration

Create or update `wrangler.json` (or `wrangler.toml`) at the project root:

```json
{
  "name": "my-viact-app",
  "main": "dist/server/server.js",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "dist/client"
  }
}
```

The `ASSETS` binding is automatically available when `assets.directory` is configured.

#### Deploy

```bash
npx wrangler deploy
```

#### Bindings (KV, D1, R2)

Access Cloudflare bindings through the context in loaders/actions/middleware:

```ts
export async function loader({ context }: LoaderArgs) {
  // context.env contains all bindings
  const value = await context.env.MY_KV.get("key");
  return { value };
}
```

Add bindings to `wrangler.json`:
```json
{
  "kv_namespaces": [{ "binding": "MY_KV", "id": "..." }],
  "d1_databases": [{ "binding": "DB", "database_id": "..." }]
}
```

#### Custom assets binding

If using a non-default assets binding name:
```ts
viact({ adapter: "cloudflare", cloudflareAssetsBinding: "STATIC" })
```

---

### General deployment checklist

1. **Build**: Run `viact build` and verify `dist/` output.
2. **Environment variables**: Ensure any secrets/config needed by loaders are available at runtime.
3. **Static assets**: Verify `dist/client/` contains prerendered HTML for SSG/ISG routes.
4. **ISG routes**: Confirm the ISG manifest exists if using incremental static generation.
5. **API routes**: Test API endpoints work in the production build (`viact preview`).
6. **Middleware**: Verify auth/redirect middleware behaves correctly in production.

### Rules

1. Read `vite.config.ts` and `package.json` before giving advice — don't assume the current adapter.
2. Run `viact build` to verify the build succeeds before deploying.
3. Use `viact preview` to smoke-test before pushing to production.
4. If the user needs an adapter that isn't installed, help them add it (`pnpm add @viact/adapter-*`).
5. Don't push to production without the user's explicit confirmation.

$ARGUMENTS
