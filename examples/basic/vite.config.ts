import { defineConfig } from "vite";
import { viact } from "@viact/vite-plugin";
import { cloudflareAdapter } from "@viact/adapter-cloudflare";
import { nodeAdapter } from "@viact/adapter-node";
import { vercelAdapter } from "@viact/adapter-vercel";

const adapter =
  process.env.VIACT_ADAPTER === "vercel"
    ? vercelAdapter()
    : process.env.VIACT_ADAPTER === "node"
      ? nodeAdapter()
      : cloudflareAdapter();

export default defineConfig({
  plugins: [viact({ adapter })],
});
