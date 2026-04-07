import type { LoaderArgs, RouteComponentProps } from "pracht";

export const RENDER_MODE = "ssg";

export async function loader(_args: LoaderArgs) {
  return {
    message: "Welcome to pracht with file-system routing!",
  };
}

export function Component({ data }: RouteComponentProps<typeof loader>) {
  return (
    <section>
      <h1>{data.message}</h1>
      <p>This page uses the pages router with auto-discovered routes.</p>
    </section>
  );
}
