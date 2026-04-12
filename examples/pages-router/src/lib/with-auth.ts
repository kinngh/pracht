import type { ApiRouteArgs, ApiRouteHandler } from "@pracht/core";

/**
 * Higher-order function that checks for a session cookie before calling the
 * wrapped handler. Use it to protect individual API routes without a manifest:
 *
 *   export const GET = withAuth((args) => Response.json({ ok: true }));
 *
 * ⚠️ NOT FOR PRODUCTION — a real check should verify a cryptographic signature.
 */
export function withAuth(handler: ApiRouteHandler): ApiRouteHandler {
  return async (args: ApiRouteArgs) => {
    const hasSession = args.request.headers.get("cookie")?.includes("session=") ?? false;

    if (!hasSession) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    return handler(args);
  };
}
