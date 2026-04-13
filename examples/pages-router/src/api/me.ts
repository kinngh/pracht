import { withAuth } from "../lib/with-auth";

export const GET = withAuth(() => {
  return Response.json({ user: "Alice", email: "alice@example.com" });
});
