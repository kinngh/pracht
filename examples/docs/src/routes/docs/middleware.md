---
title: Middleware
lead: Server-side request interceptors that run before loaders and API routes. Use them for authentication, redirects, request validation, and context enrichment.
breadcrumb: Middleware
prev:
  href: /docs/api-routes
  title: API Routes
next:
  href: /docs/shells
  title: Shells
---

## Defining Middleware

Middleware modules live in `src/middleware/` and export a `middleware` function:

```ts [src/middleware/auth.ts]
import type { MiddlewareFn } from "@pracht/core";

export const middleware: MiddlewareFn = async ({ request }) => {
  const session = await getSession(request);

  // Redirect unauthenticated users
  if (!session) {
    return { redirect: "/login" };
  }

  // Return void to continue to the loader
};
```

---

## Applying Middleware

Register middleware by name in `defineApp`, then reference them in routes or groups:

```ts [src/routes.ts]
export const app = defineApp({
  middleware: {
    auth: "./middleware/auth.ts",
    rateLimit: "./middleware/rate-limit.ts",
  },
  routes: [
    // Applied to a single route
    route("/profile", "./routes/profile.tsx", { middleware: ["auth"] }),

    // Applied to a group — all children inherit
    group({ middleware: ["auth"], shell: "app" }, [
      route("/dashboard", "./routes/dashboard.tsx"),
      route("/settings", "./routes/settings.tsx"),
    ]),
  ],
});
```

---

## Middleware Stacking

Middleware from groups and routes is combined. A route inside a group with `["auth"]` that also declares `["rateLimit"]` runs both in order:

1. `auth` (from group)
2. `rateLimit` (from route)
3. Loader / API route

---

## Middleware Results

| Return                            | Effect                                    |
| --------------------------------- | ----------------------------------------- |
| `undefined` / `void`              | Continue to the next middleware or loader |
| `{ redirect: "/path" }`           | HTTP 302 redirect                         |
| `{ response: new Response(...) }` | Short-circuit with a custom response      |

---

## Without a Manifest (Higher-Order Functions)

When using the **pages router** (or any setup without `routes.ts`), there is no manifest to register middleware in. Instead, wrap API handlers with plain higher-order functions:

```ts [src/lib/with-auth.ts]
import type { ApiRouteArgs, ApiRouteHandler } from "@pracht/core";

export function withAuth(handler: ApiRouteHandler): ApiRouteHandler {
  return async (args: ApiRouteArgs) => {
    const session = args.request.headers.get("cookie")?.includes("session=");
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(args);
  };
}
```

```ts [src/api/me.ts]
import { withAuth } from "../lib/with-auth";

export const GET = withAuth(({ request }) => {
  return Response.json({ user: "Alice" });
});
```

Multiple wrappers compose naturally: `withAuth(withRateLimit(handler))`. See [API Routes](/docs/api-routes) for more detail and stacking examples.
