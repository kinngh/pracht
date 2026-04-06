import { createContext, h } from "preact";
import type { ComponentChildren, JSX, VNode } from "preact";
import { useContext } from "preact/hooks";

import { matchAppRoute } from "./app.ts";
import type {
  BaseRouteArgs,
  HeadMetadata,
  MiddlewareModule,
  ModuleImporter,
  ModuleRegistry,
  RouteModule,
  ShellModule,
  ViactApp,
} from "./types.ts";

export interface ViactHydrationState<TData = unknown> {
  url: string;
  routeId: string;
  data: TData;
}

export interface StartAppOptions<TData = unknown> {
  initialData?: TData;
}

export interface HandleViactRequestOptions<TContext = unknown> {
  app: ViactApp;
  request: Request;
  context?: TContext;
  registry?: ModuleRegistry;
  clientEntryUrl?: string;
  cssUrls?: string[];
}

export interface SubmitActionOptions {
  action?: string;
  method?: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
}

export interface FormProps
  extends Omit<JSX.HTMLAttributes<HTMLFormElement>, "action" | "method"> {
  action?: string;
  method?: string;
}

declare global {
  interface Window {
    __VIACT_STATE__?: ViactHydrationState;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

const RouteDataContext = createContext<unknown>(undefined);

export function ViactRuntimeProvider<TData>({
  children,
  data,
}: {
  children: ComponentChildren;
  data: TData;
}) {
  return h(RouteDataContext.Provider, {
    value: data,
    children,
  });
}

export function startApp<TData = unknown>(
  options: StartAppOptions<TData> = {},
): TData | undefined {
  if (typeof window === "undefined") {
    return options.initialData;
  }

  if (typeof options.initialData !== "undefined") {
    return options.initialData;
  }

  return window.__VIACT_STATE__?.data as TData | undefined;
}

export function useRouteData<TData = unknown>(): TData {
  return useContext(RouteDataContext) as TData;
}

export function useRevalidateRoute() {
  return async () => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const response = await fetch(window.location.pathname, {
      headers: {
        "x-viact-route-state-request": "1",
      },
    });

    return readResponseBody(response);
  };
}

export function useSubmitAction() {
  return async (options: SubmitActionOptions = {}) => {
    if (typeof window === "undefined") {
      throw new Error("useSubmitAction can only be used in the browser.");
    }

    const response = await fetch(options.action ?? window.location.pathname, {
      method: options.method ?? "POST",
      body: options.body ?? null,
      headers: options.headers,
    });

    return readResponseBody(response);
  };
}

export function Form(props: FormProps) {
  return h("form", props as JSX.HTMLAttributes<HTMLFormElement>);
}

export async function handleViactRequest<TContext>(
  options: HandleViactRequestOptions<TContext>,
): Promise<Response> {
  const url = new URL(options.request.url);
  const match = matchAppRoute(options.app, url.pathname);

  if (!match) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const registry = options.registry ?? {};
  const isRouteStateRequest =
    options.request.headers.get("x-viact-route-state-request") === "1";
  const isAction = !SAFE_METHODS.has(options.request.method);

  // --- Middleware chain ---
  let context = (options.context ?? {}) as TContext;
  for (const mwFile of match.route.middlewareFiles) {
    const mwModule = await resolveRegistryModule<MiddlewareModule>(
      registry.middlewareModules,
      mwFile,
    );
    if (!mwModule?.middleware) continue;

    const result = await mwModule.middleware({
      request: options.request,
      params: match.params,
      context,
      signal: AbortSignal.timeout(30_000),
      url,
      route: match.route,
    });

    if (!result) continue;
    if (result instanceof Response) return result;
    if ("redirect" in result) {
      return new Response(null, {
        status: 302,
        headers: { location: result.redirect },
      });
    }
    if ("context" in result) {
      context = { ...context, ...result.context } as TContext;
    }
  }

  // --- Load route module ---
  const routeModule = await resolveRegistryModule<RouteModule>(
    registry.routeModules,
    match.route.file,
  );

  const routeArgs: BaseRouteArgs<TContext> = {
    request: options.request,
    params: match.params,
    context,
    signal: AbortSignal.timeout(30_000),
    url,
    route: match.route,
  };

  // --- Handle actions (POST/PUT/PATCH/DELETE) ---
  if (isAction) {
    if (!routeModule?.action) {
      return new Response("Method not allowed", {
        status: 405,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const actionResult = await routeModule.action(routeArgs);
    return Response.json(actionResult, {
      headers: { "content-type": "application/json" },
    });
  }

  // --- Execute loader ---
  const data = routeModule?.loader
    ? await routeModule.loader(routeArgs)
    : undefined;

  // --- Route state request (client navigation): return JSON ---
  if (isRouteStateRequest) {
    return Response.json({ data });
  }

  // --- Load shell module ---
  const shellModule = match.route.shellFile
    ? await resolveRegistryModule<ShellModule>(
        registry.shellModules,
        match.route.shellFile,
      )
    : undefined;

  // --- Merge head metadata ---
  const head = await mergeHeadMetadata(shellModule, routeModule, routeArgs, data);

  // --- SPA mode: shell HTML with empty body, no SSR ---
  if (match.route.render === "spa") {
    return htmlResponse(
      buildHtmlDocument({
        head,
        body: "",
        hydrationState: {
          url: url.pathname,
          routeId: match.route.id ?? "",
          data: null,
        },
        clientEntryUrl: options.clientEntryUrl,
        cssUrls: options.cssUrls,
      }),
    );
  }

  // --- SSR / SSG / ISG: render Preact tree to string ---
  if (!routeModule?.Component) {
    return new Response("Route has no Component export", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { renderToString } = (await import(
    "preact-render-to-string"
  )) as { renderToString: (vnode: VNode<any>) => string };

  const Component = routeModule.Component as any;
  const Shell = shellModule?.Shell;
  const componentProps = { data, params: match.params };

  const componentTree = Shell
    ? h(Shell, null, h(Component, componentProps))
    : h(Component, componentProps);

  const tree = h(ViactRuntimeProvider as any, { data }, componentTree);
  const ssrContent = renderToString(tree);

  return htmlResponse(
    buildHtmlDocument({
      head,
      body: ssrContent,
      hydrationState: {
        url: url.pathname,
        routeId: match.route.id ?? "",
        data,
      },
      clientEntryUrl: options.clientEntryUrl,
      cssUrls: options.cssUrls,
    }),
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolveRegistryModule<T>(
  modules: Record<string, ModuleImporter> | undefined,
  file: string,
): Promise<T | undefined> {
  if (!modules) return undefined;

  // Direct key match
  if (file in modules) {
    return modules[file]() as Promise<T>;
  }

  // Suffix match: strip leading ./ and match against registry keys
  const suffix = file.replace(/^\.\//, "");
  for (const key of Object.keys(modules)) {
    if (key.endsWith(`/${suffix}`) || key.endsWith(suffix)) {
      return modules[key]() as Promise<T>;
    }
  }

  return undefined;
}

async function mergeHeadMetadata(
  shellModule: ShellModule | undefined,
  routeModule: RouteModule | undefined,
  routeArgs: BaseRouteArgs<unknown>,
  data: unknown,
): Promise<HeadMetadata> {
  const shellHead =
    shellModule?.head ? await shellModule.head(routeArgs) : {};
  const routeHead =
    routeModule?.head
      ? await routeModule.head({ ...routeArgs, data } as any)
      : {};

  return {
    title: routeHead.title ?? shellHead.title,
    meta: [...(shellHead.meta ?? []), ...(routeHead.meta ?? [])],
    link: [...(shellHead.link ?? []), ...(routeHead.link ?? [])],
  };
}

function buildHtmlDocument(options: {
  head: HeadMetadata;
  body: string;
  hydrationState: ViactHydrationState;
  clientEntryUrl?: string;
  cssUrls?: string[];
}): string {
  const { head, body, hydrationState, clientEntryUrl, cssUrls = [] } = options;

  const titleTag = head.title
    ? `<title>${escapeHtml(head.title)}</title>`
    : "";

  const metaTags = (head.meta ?? [])
    .map(
      (m) =>
        `<meta ${Object.entries(m)
          .map(([k, v]) => `${k}="${escapeHtml(v)}"`)
          .join(" ")}>`,
    )
    .join("\n    ");

  const linkTags = (head.link ?? [])
    .map(
      (l) =>
        `<link ${Object.entries(l)
          .map(([k, v]) => `${k}="${escapeHtml(v)}"`)
          .join(" ")}>`,
    )
    .join("\n    ");

  const cssTags = cssUrls
    .map((url) => `<link rel="stylesheet" href="${escapeHtml(url)}">`)
    .join("\n    ");

  const stateScript = `<script>window.__VIACT_STATE__=${JSON.stringify(hydrationState)}</script>`;
  const entryScript = clientEntryUrl
    ? `<script type="module" src="${escapeHtml(clientEntryUrl)}"></script>`
    : "";

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    ${titleTag}
    ${metaTags}
    ${linkTags}
    ${cssTags}
  </head>
  <body>
    <div id="viact-root">${body}</div>
    ${stateScript}
    ${entryScript}
  </body>
</html>`;
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}
