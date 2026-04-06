import { defineApp, group, route } from "viact";

export const app = defineApp({
  shells: {
    home: "./shells/home.tsx",
    docs: "./shells/docs.tsx",
  },
  routes: [
    group({ shell: "home" }, [route("/", "./routes/home.tsx", { id: "home", render: "ssg" })]),
    group({ shell: "docs" }, [
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
      route("/docs/adapters", "./routes/docs/adapters.tsx", {
        id: "adapters",
        render: "ssg",
      }),
    ]),
  ],
});
