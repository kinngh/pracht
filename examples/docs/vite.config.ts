import { defineConfig } from "vite";
import { viact } from "@viact/vite-plugin";
import { cloudflareAdapter } from "@viact/adapter-cloudflare";
import { markdown } from "./vite-plugin-md";

export default defineConfig({
  plugins: [markdown(), viact({ adapter: cloudflareAdapter() })],
});
