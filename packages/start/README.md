# create-viact

Interactive starter CLI for bootstrapping a new viact app.

## What It Does

- Prompts for the target folder.
- Detects the active package manager from the current environment.
- Lets the user choose between the Node.js and Cloudflare adapters.
- Scaffolds a minimal app with a route manifest, shell, home route, and sample API route.

## Usage

```bash
node ./packages/start/bin/create-viact.js
node ./packages/start/bin/create-viact.js my-app --adapter=node --skip-install
```

## Generated Files

- `package.json`
- `vite.config.ts`
- `src/routes.ts`
- `src/routes/home.tsx`
- `src/shells/public.tsx`
- `src/api/health.ts`

Cloudflare scaffolds also include:

- `src/worker.ts`
- `vite.worker.config.ts`
- `wrangler.jsonc`
