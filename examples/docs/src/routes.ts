import { defineApp, group, route } from "viact";

export const app = defineApp({
  shells: {
    home: "./shells/home.tsx",
    docs: "./shells/docs.tsx",
  },
  routes: [
    group({ shell: "home" }, [route("/", "./routes/home.tsx", { id: "home", render: "ssg" })]),
    group({ shell: "docs" }, [
      route("/docs", "./routes/docs/index.tsx", { id: "docs-index", render: "ssr" }),
      route("/docs/getting-started", "./routes/docs/getting-started.tsx", {
        id: "getting-started",
        render: "ssg",
      }),
      route("/docs/routing", "./routes/docs/routing.tsx", {
        id: "routing",
        render: "ssg",
      }),
      route("/docs/rendering", "./routes/docs/rendering.tsx", {
        id: "rendering",
        render: "ssg",
      }),
      route("/docs/data-loading", "./routes/docs/data-loading.tsx", {
        id: "data-loading",
        render: "ssg",
      }),
      route("/docs/api-routes", "./routes/docs/api-routes.tsx", {
        id: "api-routes",
        render: "ssg",
      }),
      route("/docs/middleware", "./routes/docs/middleware.tsx", {
        id: "middleware",
        render: "ssg",
      }),
      route("/docs/shells", "./routes/docs/shells.tsx", {
        id: "shells",
        render: "ssg",
      }),
      route("/docs/cli", "./routes/docs/cli.tsx", {
        id: "cli",
        render: "ssg",
      }),
      route("/docs/deployment", "./routes/docs/deployment.tsx", {
        id: "deployment",
        render: "ssg",
      }),
      route("/docs/adapters", "./routes/docs/adapters.tsx", {
        id: "adapters",
        render: "ssg",
      }),
      route("/docs/prefetching", "./routes/docs/prefetching.tsx", {
        id: "prefetching",
        render: "ssg",
      }),
      route("/docs/performance", "./routes/docs/performance.tsx", {
        id: "performance",
        render: "ssg",
      }),
      route("/docs/recipes/i18n", "./routes/docs/recipes-i18n.tsx", {
        id: "recipes-i18n",
        render: "ssg",
      }),
      route("/docs/recipes/auth", "./routes/docs/recipes-auth.tsx", {
        id: "recipes-auth",
        render: "ssg",
      }),
      route("/docs/recipes/forms", "./routes/docs/recipes-forms.tsx", {
        id: "recipes-forms",
        render: "ssg",
      }),
      route("/docs/recipes/testing", "./routes/docs/recipes-testing.tsx", {
        id: "recipes-testing",
        render: "ssg",
      }),
    ]),
  ],
});
