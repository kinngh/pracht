# Viact Scaffold

Generate viact framework modules with correct types, exports, and manifest wiring.

## Instructions

You are scaffolding code for the **viact** framework — a full-stack Preact framework built on Vite.

The user will describe what they want to create. Parse their request and generate the appropriate module(s). Always ask if anything is ambiguous (e.g. render mode, shell assignment).

### What you can scaffold

| Kind | Directory | Key exports | Example |
|------|-----------|-------------|---------|
| Route | `src/routes/` | `loader`, `action`, `head`, `Component`, `ErrorBoundary`, `prerender` | `src/routes/blog.tsx` |
| Shell | `src/shells/` | `Shell`, `head` | `src/shells/marketing.tsx` |
| Middleware | `src/middleware/` | `middleware` | `src/middleware/rate-limit.ts` |
| API route | `src/api/` | Named HTTP method handlers (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) | `src/api/users/[id].ts` |

### Route module template

```tsx
import type { LoaderArgs, RouteComponentProps } from "viact";

export async function loader(_args: LoaderArgs) {
  return { /* loader data */ };
}

export function head() {
  return { title: "Page Title" };
}

export function Component({ data }: RouteComponentProps<typeof loader>) {
  return <section>{/* route UI */}</section>;
}
```

- Include `action` only if the user asks for form handling or mutations.
- Include `ErrorBoundary` only if requested.
- Include `prerender` only for SSG/ISG routes with dynamic segments.
- Use `RouteComponentProps<typeof loader>` for typed `data` prop.
- Import `Form` from `"viact"` when adding actions.

### Shell module template

```tsx
import type { ShellProps } from "viact";

export function Shell({ children }: ShellProps) {
  return (
    <div class="shell-name">
      <nav>{/* navigation */}</nav>
      <main>{children}</main>
    </div>
  );
}

export function head() {
  return { title: "Shell Title" };
}
```

### Middleware module template

```ts
import type { MiddlewareFn } from "viact";

export const middleware: MiddlewareFn = async ({ request }) => {
  // Return void to continue, { redirect: "/path" } to redirect,
  // a Response to short-circuit, or { context: { ... } } to augment context.
};
```

### API route module template

```ts
import type { BaseRouteArgs } from "viact";

export function GET({ params, url }: BaseRouteArgs) {
  return Response.json({ /* response data */ });
}
```

- Only include the HTTP methods the user needs.
- Use `request.json()`, `request.formData()`, etc. for body parsing.
- Always return `Response` objects (typically `Response.json()`).
- Dynamic segments use bracket syntax in filenames: `[id].ts`, `[...slug].ts`.

### Wiring into the manifest

After creating module files, **always update `src/routes.ts`** to register the new module:

- **Routes**: Add a `route("/path", "./routes/filename.tsx", { id: "name", render: "ssr" })` call inside the appropriate group or at the top level.
- **Shells**: Add to the `shells` record: `shellName: "./shells/filename.tsx"`.
- **Middleware**: Add to the `middleware` record: `mwName: "./middleware/filename.ts"`.
- **API routes**: No manifest change needed — auto-discovered from `src/api/` by the Vite plugin.

Available render modes: `"ssr"` (default for dynamic), `"ssg"` (static at build), `"isg"` (incremental static with `revalidate: timeRevalidate(seconds)`), `"spa"` (client-only).

Import `timeRevalidate` from `"viact"` when using ISG.

### Rules

1. Use the project's existing `src/routes.ts` to determine current shells, middleware, and route structure before adding.
2. Place files in the conventional directories (`src/routes/`, `src/shells/`, `src/middleware/`, `src/api/`).
3. Keep generated code minimal — only include exports the user actually needs.
4. Use Preact idioms: `class` not `className`, functional components, `import type` for type-only imports.
5. After scaffolding, summarize what was created and how it was wired.

$ARGUMENTS
