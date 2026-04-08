import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts", "src/error-overlay.ts"],
  format: "esm",
  dts: true,
  external: ["preact", "preact/hooks", "preact-render-to-string"],
});
