import { defineConfig } from "vite";
import { viact } from "@viact/vite-plugin";

async function resolveAdapter() {
  if (process.env.VIACT_ADAPTER === "vercel") {
    const { vercelAdapter } = await import("@viact/adapter-vercel");
    return vercelAdapter();
  }

  if (process.env.VIACT_ADAPTER === "node") {
    const { nodeAdapter } = await import("@viact/adapter-node");
    return nodeAdapter();
  }

  const { cloudflareAdapter } = await import("@viact/adapter-cloudflare");
  return cloudflareAdapter();
}

export default defineConfig(async () => ({
  plugins: [viact({ adapter: await resolveAdapter() })],
}));
