import { defineConfig } from "vite";
import { viact } from "@viact/vite-plugin";
import { cloudflareAdapter } from "@viact/adapter-cloudflare";

export default defineConfig({
  plugins: [viact({ adapter: cloudflareAdapter() })],
});
