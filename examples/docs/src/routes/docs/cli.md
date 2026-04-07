---
title: CLI
lead: The <code>@pracht/cli</code> package provides three commands for development, building, and previewing your app.
breadcrumb: CLI
prev:
  href: /docs/shells
  title: Shells
next:
  href: /docs/deployment
  title: Deployment
---

## pracht dev

Starts the Vite dev server with SSR middleware, HMR, and instant feedback.

```sh
pracht dev

# Custom port
PORT=4000 pracht dev
```

Routes are rendered server-side on each request. Changes to routes, shells, loaders, and components are reflected immediately via HMR.

---

## pracht build

Runs a production build: client bundle, server bundle, and SSG/ISG prerendering.

```sh
pracht build
```

Output:

- `dist/client/` — static assets with hashed filenames
- `dist/server/server.js` — server entry module
- SSG routes are pre-rendered as static HTML in `dist/client/`

---

## pracht preview

Runs the production server entry locally. Useful for smoke-testing the build before deploying.

```sh
pracht preview

# Custom port
PORT=4000 pracht preview
```

---

## Installation

The CLI is included in scaffolded projects. For existing projects, add it as a dev dependency:

```sh
pnpm add -D @pracht/cli
```

Then add scripts to your `package.json`:

```json [package.json]
{
  "scripts": {
    "dev": "pracht dev",
    "build": "pracht build",
    "preview": "pracht preview"
  }
}
```
