import type { BaseRouteArgs } from "@pracht/core";

export async function POST({ request }: BaseRouteArgs) {
  const body = await request.json();
  return Response.json({ echo: body });
}
