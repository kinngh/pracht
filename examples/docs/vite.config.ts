import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { viact } from "@viact/vite-plugin";

export default defineConfig({
  plugins: [preact(), viact({ adapter: "cloudflare" })],
});
