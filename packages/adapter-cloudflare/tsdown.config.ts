import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  external: ["pracht", "@pracht/vite-plugin", /^node:/],
});
