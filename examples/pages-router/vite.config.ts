import { defineConfig } from "vite";
import { viact } from "@viact/vite-plugin";

async function resolveAdapter() {
  const { nodeAdapter } = await import("@viact/adapter-node");
  return nodeAdapter();
}

export default defineConfig(async () => ({
  plugins: [viact({ pagesDir: "/src/pages", adapter: await resolveAdapter() })],
}));
