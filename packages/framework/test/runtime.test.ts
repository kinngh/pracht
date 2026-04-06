import { describe, expect, it } from "vitest";

import { defineApp, handleViactRequest, resolveApiRoutes, route } from "../src/index.ts";

describe("handleViactRequest actions", () => {
  it("translates redirect envelopes into HTTP redirects with headers", async () => {
    const app = defineApp({
      routes: [route("/", "./routes/home.tsx")],
    });

    const response = await handleViactRequest({
      app,
      registry: {
        routeModules: {
          "./routes/home.tsx": async () => ({
            Component: () => null,
            action: async () => ({
              headers: { "set-cookie": "viact=1" },
              redirect: "/done",
            }),
          }),
        },
      },
      request: new Request("http://localhost/", {
        headers: {
          origin: "http://localhost",
        },
        method: "POST",
      }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/done");
    expect(response.headers.get("set-cookie")).toBe("viact=1");
  });
});

describe("handleViactRequest API middleware", () => {
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

    const response = await handleViactRequest({
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
