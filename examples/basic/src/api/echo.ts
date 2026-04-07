import type { BaseRouteArgs } from "pracht";

export async function POST({ request }: BaseRouteArgs) {
  const body = await request.json();
  return Response.json({ echo: body });
}
