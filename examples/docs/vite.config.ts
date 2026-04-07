import { defineConfig } from "vite";
import { pracht } from "@pracht/vite-plugin";
import { cloudflareAdapter } from "@pracht/adapter-cloudflare";
import { markdown } from "./vite-plugin-md";

export default defineConfig({
  plugins: [markdown(), pracht({ adapter: cloudflareAdapter() })],
});
