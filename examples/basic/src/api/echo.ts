import type { BaseRouteArgs } from "viact";

export async function POST({ request }: BaseRouteArgs) {
  const body = await request.json();
  return Response.json({ echo: body });
}
