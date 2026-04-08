import { h } from "preact";
import { describe, expect, it } from "vitest";

import {
  PrachtHttpError,
  defineApp,
  handlePrachtRequest,
  resolveApiRoutes,
  route,
  useParams,
} from "../src/index.ts";

describe("handlePrachtRequest rejects non-GET on page routes", () => {
  it("returns 405 for POST to a page route", async () => {
    const app = defineApp({
      routes: [route("/", "./routes/home.tsx")],
    });

    const response = await handlePrachtRequest({
      app,
      registry: {
        routeModules: {
          "./routes/home.tsx": async () => ({
            Component: () => null,
          }),
        },
      },
      request: new Request("http://localhost/", {
        method: "POST",
      }),
    });

    expect(response.status).toBe(405);
  });
});

describe("handlePrachtRequest API middleware", () => {
  it("runs configured API middleware before handlers", async () => {
    const app = defineApp({
      api: {
        middleware: ["apiAuth"],
      },
      middleware: {
        apiAuth: "./middleware/api-auth.ts",
      },
      routes: [route("/", "./routes/home.tsx")],
    });

    const response = await handlePrachtRequest({
      apiRoutes: resolveApiRoutes(["/src/api/health.ts"]),
      app,
      registry: {
        apiModules: {
          "/src/api/health.ts": async () => ({
            GET: async ({ context }) => Response.json(context),
          }),
        },
        middlewareModules: {
          "./middleware/api-auth.ts": async () => ({
            middleware: async () => ({
              context: { allowed: true },
            }),
          }),
        },
      },
      request: new Request("http://localhost/api/health"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ allowed: true });
  });
});

describe("handlePrachtRequest with separate data modules", () => {
  it("resolves loader from a separate dataModule via loaderFile", async () => {
    const app = defineApp({
      routes: [
        route("/dashboard", {
          component: "./routes/dashboard.tsx",
          loader: "./server/dashboard-loader.ts",
          render: "ssr",
        }),
      ],
    });

    const response = await handlePrachtRequest({
      app,
      registry: {
        routeModules: {
          "./routes/dashboard.tsx": async () => ({
            Component: ({ data }) => h("main", null, `Hello ${(data as any).user}`),
          }),
        },
        dataModules: {
          "./server/dashboard-loader.ts": async () => ({
            loader: async () => ({ user: "Jovi" }),
          }),
        },
      },
      request: new Request("http://localhost/dashboard"),
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Hello Jovi");
  });

  it("returns 405 for POST to a page route with separate loader", async () => {
    const app = defineApp({
      routes: [
        route("/dashboard", {
          component: "./routes/dashboard.tsx",
          loader: "./server/dashboard-loader.ts",
          render: "ssr",
        }),
      ],
    });

    const response = await handlePrachtRequest({
      app,
      registry: {
        routeModules: {
          "./routes/dashboard.tsx": async () => ({
            Component: () => h("main", null, "dashboard"),
          }),
        },
        dataModules: {
          "./server/dashboard-loader.ts": async () => ({
            loader: async () => ({ user: "Jovi" }),
          }),
        },
      },
      request: new Request("http://localhost/dashboard", {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
    });

    expect(response.status).toBe(405);
  });

  it("falls back to route module loader when no loaderFile is set", async () => {
    const app = defineApp({
      routes: [route("/home", "./routes/home.tsx", { render: "ssr" })],
    });

    const response = await handlePrachtRequest({
      app,
      registry: {
        routeModules: {
          "./routes/home.tsx": async () => ({
            Component: ({ data }) => h("main", null, `Hello ${(data as any).name}`),
            loader: async () => ({ name: "inline" }),
          }),
        },
      },
      request: new Request("http://localhost/home"),
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Hello inline");
  });
});

describe("useParams", () => {
  it("provides route params to nested components during SSR", async () => {
    const app = defineApp({
      routes: [route("/products/:id", "./routes/product.tsx", { render: "ssr" })],
    });

    function NestedParamsDisplay() {
      const params = useParams();
      return h("span", { class: "params-id" }, params.id ?? "none");
    }

    const response = await handlePrachtRequest({
      app,
      registry: {
        routeModules: {
          "./routes/product.tsx": async () => ({
            Component: () => h("main", null, h(NestedParamsDisplay, null)),
            loader: async () => ({ name: "Widget" }),
          }),
        },
      },
      request: new Request("http://localhost/products/42"),
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("42");
  });

  it("provides empty params for static routes during SSR", async () => {
    const app = defineApp({
      routes: [route("/home", "./routes/home.tsx", { render: "ssr" })],
    });

    function NestedParamsDisplay() {
      const params = useParams();
      const keys = Object.keys(params);
      return h("span", null, `keys:${keys.length}`);
    }

    const response = await handlePrachtRequest({
      app,
      registry: {
        routeModules: {
          "./routes/home.tsx": async () => ({
            Component: () => h("main", null, h(NestedParamsDisplay, null)),
          }),
        },
      },
      request: new Request("http://localhost/home"),
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("keys:0");
  });
});

describe("handlePrachtRequest ErrorBoundary", () => {
  it("renders the route error boundary for loader failures", async () => {
    const app = defineApp({
      routes: [route("/posts/:slug", "./routes/post.tsx")],
    });

    const response = await handlePrachtRequest({
      app,
      registry: {
        routeModules: {
          "./routes/post.tsx": async () => ({
            Component: () => h("main", null, "post"),
            ErrorBoundary: ({ error }) => h("p", null, `Error: ${error.message}`),
            loader: async () => {
              throw new PrachtHttpError(404, "Post not found");
            },
          }),
        },
      },
      request: new Request("http://localhost/posts/missing"),
    });

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain("Error: Post not found");
  });

  it("sanitizes unexpected 5xx loader failures in SSR output and hydration state", async () => {
    const app = defineApp({
      routes: [route("/posts/:slug", "./routes/post.tsx")],
    });

    const response = await handlePrachtRequest({
      app,
      registry: {
        routeModules: {
          "./routes/post.tsx": async () => ({
            Component: () => h("main", null, "post"),
            ErrorBoundary: ({ error }) => h("p", null, `Error: ${error.message}`),
            loader: async () => {
              throw new Error("Database credentials invalid");
            },
          }),
        },
      },
      request: new Request("http://localhost/posts/missing"),
    });

    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("Error: Internal Server Error");
    expect(html).not.toContain("Database credentials invalid");
  });

  it("returns a route-state error payload for loader failures", async () => {
    const app = defineApp({
      routes: [route("/posts/:slug", "./routes/post.tsx")],
    });

    const response = await handlePrachtRequest({
      app,
      registry: {
        routeModules: {
          "./routes/post.tsx": async () => ({
            Component: () => h("main", null, "post"),
            ErrorBoundary: ({ error }) => h("p", null, `Error: ${error.message}`),
            loader: async () => {
              throw new PrachtHttpError(404, "Post not found");
            },
          }),
        },
      },
      request: new Request("http://localhost/posts/missing", {
        headers: {
          "x-pracht-route-state-request": "1",
        },
      }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: "Post not found",
        name: "PrachtHttpError",
        status: 404,
      },
    });
  });

  it("sanitizes unexpected 5xx loader failures in route-state responses", async () => {
    const app = defineApp({
      routes: [route("/posts/:slug", "./routes/post.tsx")],
    });

    const response = await handlePrachtRequest({
      app,
      registry: {
        routeModules: {
          "./routes/post.tsx": async () => ({
            Component: () => h("main", null, "post"),
            ErrorBoundary: ({ error }) => h("p", null, `Error: ${error.message}`),
            loader: async () => {
              throw new Error("token parse failed");
            },
          }),
        },
      },
      request: new Request("http://localhost/posts/missing", {
        headers: {
          "x-pracht-route-state-request": "1",
        },
      }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: "Internal Server Error",
        name: "Error",
        status: 500,
      },
    });
  });

  it("sanitizes explicit 5xx PrachtHttpError messages by default", async () => {
    const app = defineApp({
      routes: [route("/posts/:slug", "./routes/post.tsx")],
    });

    const response = await handlePrachtRequest({
      app,
      registry: {
        routeModules: {
          "./routes/post.tsx": async () => ({
            Component: () => h("main", null, "post"),
            ErrorBoundary: ({ error }) => h("p", null, `Error: ${error.message}`),
            loader: async () => {
              throw new PrachtHttpError(503, "Upstream token service failed");
            },
          }),
        },
      },
      request: new Request("http://localhost/posts/missing", {
        headers: {
          "x-pracht-route-state-request": "1",
        },
      }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: "Internal Server Error",
        name: "Error",
        status: 503,
      },
    });
  });

  it("can expose raw server errors when debugErrors is enabled", async () => {
    const app = defineApp({
      routes: [route("/posts/:slug", "./routes/post.tsx")],
    });

    const response = await handlePrachtRequest({
      app,
      debugErrors: true,
      registry: {
        routeModules: {
          "./routes/post.tsx": async () => ({
            Component: () => h("main", null, "post"),
            ErrorBoundary: ({ error }) => h("p", null, `Error: ${error.message}`),
            loader: async () => {
              throw new Error("debug details");
            },
          }),
        },
      },
      request: new Request("http://localhost/posts/missing", {
        headers: {
          "x-pracht-route-state-request": "1",
        },
      }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: "debug details",
        name: "Error",
        status: 500,
      },
    });
  });
});
