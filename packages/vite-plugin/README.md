# @pracht/vite-plugin

Vite integration for pracht. Handles virtual module generation, multi-environment builds, and SSG prerendering.

## Install

```bash
npm install @pracht/vite-plugin
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import pracht from "@pracht/vite-plugin";

export default defineConfig({
  plugins: [pracht()],
});
```

## What It Does

- Generates virtual modules (`virtual:pracht/client`, `virtual:pracht/server`) from your route manifest
- Builds client and SSR bundles via Vite's multi-environment mode
- Pre-renders SSG and ISG routes at build time
- Provides HMR during development

## Peer Dependencies

- `vite@^8.0.0`
- `@cloudflare/vite-plugin@^1.0.0` (optional, for Cloudflare targets)
- `wrangler@^4.81.0` (optional, for Cloudflare targets)
