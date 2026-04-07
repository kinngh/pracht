import type { BaseRouteArgs } from "viact";

export async function GET({ context }: BaseRouteArgs) {
  const cached = await context.env.MY_KV.get("health:last-check");
  await context.env.MY_KV.put("health:last-check", new Date().toISOString());

  return Response.json({ status: "ok", lastCheck: cached });
}
