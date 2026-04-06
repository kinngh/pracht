import { h } from "preact";
import { describe, expect, it } from "vitest";

import {
  defineApp,
  handleViactRequest,
  resolveApiRoutes,
  route,
} from "../src/index.ts";

describe("handleViactRequest security", () => {
  it("escapes hydration state before embedding it in HTML", async () => {
    const app = defineApp({
      routes: [route("/", "./routes/home.tsx", { render: "ssr" })],
    });

    const response = await handleViactRequest({
      app,
      request: new Request("http://app.test/"),
      registry: {
        routeModules: {
          "./routes/home.tsx": async () => ({
            loader: () => ({
              message: '</script><script>alert("xss")</script>',
            }),
            Component: ({ data }: any) => h("div", null, data.message),
          }),
        },
      },
    });

    const html = await response.text();

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html).toContain('id="viact-state" type="application/json"');
    expect(html).toContain("\\u003c/script\\u003e\\u003cscript\\u003ealert");
    expect(html).not.toContain("window.__VIACT_STATE__=");
  });

  it("rejects cross-origin page actions before running the action", async () => {
    let actionCalled = false;

    const app = defineApp({
      routes: [route("/", "./routes/home.tsx", { render: "ssr" })],
    });

    const response = await handleViactRequest({
      app,
      request: new Request("http://app.test/", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      }),
      registry: {
        routeModules: {
          "./routes/home.tsx": async () => ({
            action: () => {
              actionCalled = true;
              return { ok: true };
            },
            Component: () => h("div", null, "home"),
          }),
        },
      },
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Cross-site action blocked");
    expect(actionCalled).toBe(false);
  });

  it("allows same-origin page actions", async () => {
    const app = defineApp({
      routes: [route("/", "./routes/home.tsx", { render: "ssr" })],
    });

    const response = await handleViactRequest({
      app,
      request: new Request("http://app.test/", {
        method: "POST",
        headers: { origin: "http://app.test" },
      }),
      registry: {
        routeModules: {
          "./routes/home.tsx": async () => ({
            action: () => ({ ok: true }),
            Component: () => h("div", null, "home"),
          }),
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("keeps API routes separate from page middleware", async () => {
    let middlewareCalled = false;

    const app = defineApp({
      middleware: {
        auth: "./middleware/auth.ts",
      },
      routes: [
        route("/dashboard", "./routes/dashboard.tsx", {
          middleware: ["auth"],
          render: "ssr",
        }),
      ],
    });

    const response = await handleViactRequest({
      app,
      request: new Request("http://app.test/api/health", { method: "POST" }),
      apiRoutes: resolveApiRoutes(["/src/api/health.ts"], "/src/api"),
      registry: {
        routeModules: {
          "./routes/dashboard.tsx": async () => ({
            Component: () => h("div", null, "dashboard"),
          }),
        },
        middlewareModules: {
          "./middleware/auth.ts": async () => ({
            middleware: () => {
              middlewareCalled = true;
              return new Response("blocked", { status: 401 });
            },
          }),
        },
        apiModules: {
          "/src/api/health.ts": async () => ({
            POST: () => Response.json({ ok: true }),
          }),
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(middlewareCalled).toBe(false);
  });
});
