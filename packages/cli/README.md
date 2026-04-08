# @pracht/cli

Command-line tool for developing, validating, and scaffolding pracht apps.

## Install

```bash
npm install @pracht/cli
```

## Commands

### `pracht dev`

Start the local development server with SSR and HMR.

### `pracht build`

Create a production build with client/server output and SSG/ISG prerendering.

### `pracht preview`

Run a production smoke test against the built output.

### `pracht generate route`

Create a new route module. In manifest apps this also updates `src/routes.ts`.

```bash
pracht generate route --path /dashboard --render ssr --shell app --middleware auth
```

### `pracht generate shell`

Create a shell module and register it in the app manifest.

```bash
pracht generate shell --name app
```

### `pracht generate middleware`

Create a middleware module and register it in the app manifest.

```bash
pracht generate middleware --name auth
```

### `pracht generate api`

Create an API route under `src/api/`.

```bash
pracht generate api --path /health --methods GET,POST
```

### `pracht doctor`

Validate the local app wiring. Use `--json` for machine-readable output.

```bash
pracht doctor
pracht doctor --json
```
