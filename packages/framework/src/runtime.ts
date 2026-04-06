import { createContext, h } from "preact";
import type { ComponentChildren, JSX, VNode } from "preact";
import { useContext } from "preact/hooks";

import { matchApiRoute, matchAppRoute } from "./app.ts";
import type {
  ApiRouteModule,
  BaseRouteArgs,
  HeadMetadata,
  HttpMethod,
  MiddlewareModule,
  ModuleImporter,
  ModuleRegistry,
  ResolvedApiRoute,
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
  apiRoutes?: ResolvedApiRoute[];
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
const HYDRATION_STATE_ELEMENT_ID = "viact-state";

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

  return readHydrationState<TData>()?.data;
}

export function readHydrationState<TData = unknown>():
  | ViactHydrationState<TData>
  | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (window.__VIACT_STATE__) {
    return window.__VIACT_STATE__ as ViactHydrationState<TData>;
  }

  const element = document.getElementById(HYDRATION_STATE_ELEMENT_ID);
  if (!(element instanceof HTMLScriptElement)) {
    return undefined;
  }

  const raw = element.textContent;
  if (!raw) {
    return undefined;
  }

  try {
    const state = JSON.parse(raw) as ViactHydrationState<TData>;
    window.__VIACT_STATE__ = state as ViactHydrationState;
    return state;
  } catch {
    return undefined;
  }
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

  // --- API route dispatch (before page routes) ---
  if (options.apiRoutes?.length) {
    const apiMatch = matchApiRoute(options.apiRoutes, url.pathname);
    if (apiMatch) {
      const registry = options.registry ?? {};
      const apiModule = await resolveRegistryModule<ApiRouteModule>(
        registry.apiModules,
        apiMatch.route.file,
      );

      if (!apiModule) {
        return withDefaultSecurityHeaders(new Response("API route module not found", {
          status: 500,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }));
      }

      const method = options.request.method.toUpperCase() as HttpMethod;
      const handler = apiModule[method];

      if (!handler) {
        return withDefaultSecurityHeaders(new Response("Method not allowed", {
          status: 405,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }));
      }

      return withDefaultSecurityHeaders(await handler({
        request: options.request,
        params: apiMatch.params,
        context: (options.context ?? {}) as TContext,
        signal: AbortSignal.timeout(30_000),
        url,
        route: apiMatch.route as any,
      }));
    }
  }

  const match = matchAppRoute(options.app, url.pathname);

  if (!match) {
    return withDefaultSecurityHeaders(new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    }));
  }

  const registry = options.registry ?? {};
  const isRouteStateRequest =
    options.request.headers.get("x-viact-route-state-request") === "1";
  const isAction = !SAFE_METHODS.has(options.request.method);

  if (isAction) {
    const csrfError = validateActionCsrfRequest(options.request, url);
    if (csrfError) {
      return csrfError;
    }
  }

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
    if (result instanceof Response) return withDefaultSecurityHeaders(result);
    if ("redirect" in result) {
      return withDefaultSecurityHeaders(new Response(null, {
        status: 302,
        headers: { location: result.redirect },
      }));
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
      return withDefaultSecurityHeaders(new Response("Method not allowed", {
        status: 405,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }));
    }
    const actionResult = await routeModule.action(routeArgs);
    return withDefaultSecurityHeaders(Response.json(actionResult, {
      headers: { "content-type": "application/json" },
    }));
  }

  // --- Execute loader ---
  const data = routeModule?.loader
    ? await routeModule.loader(routeArgs)
    : undefined;

  // --- Route state request (client navigation): return JSON ---
  if (isRouteStateRequest) {
    return withDefaultSecurityHeaders(Response.json({ data }));
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
    return withDefaultSecurityHeaders(new Response("Route has no Component export", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    }));
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

  const stateScript = `<script id="${HYDRATION_STATE_ELEMENT_ID}" type="application/json">${serializeJsonForHtml(hydrationState)}</script>`;
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
  return withDefaultSecurityHeaders(new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  }));
}

export function applyDefaultSecurityHeaders(headers: Headers): Headers {
  if (!headers.has("permissions-policy")) {
    headers.set(
      "permissions-policy",
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    );
  }

  if (!headers.has("referrer-policy")) {
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
  }

  if (!headers.has("x-content-type-options")) {
    headers.set("x-content-type-options", "nosniff");
  }

  if (!headers.has("x-frame-options")) {
    headers.set("x-frame-options", "SAMEORIGIN");
  }

  return headers;
}

function withDefaultSecurityHeaders(response: Response): Response {
  const headers = applyDefaultSecurityHeaders(new Headers(response.headers));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function validateActionCsrfRequest(request: Request, url: URL): Response | null {
  const origin = request.headers.get("origin");
  if (origin) {
    return isSameOrigin(origin, url.origin) ? null : createCsrfErrorResponse();
  }

  const referer = request.headers.get("referer");
  if (referer) {
    return isSameOrigin(referer, url.origin) ? null : createCsrfErrorResponse();
  }

  return createCsrfErrorResponse();
}

function isSameOrigin(candidate: string, expectedOrigin: string): boolean {
  try {
    return new URL(candidate).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function createCsrfErrorResponse(): Response {
  return withDefaultSecurityHeaders(new Response("Cross-site action blocked", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  }));
}

// ---------------------------------------------------------------------------
// SSG Prerendering
// ---------------------------------------------------------------------------

export interface PrerenderResult {
  path: string;
  html: string;
}

export interface ISGManifestEntry {
  revalidate: import("./types.ts").RouteRevalidate;
}

export interface PrerenderAppResult {
  pages: PrerenderResult[];
  isgManifest: Record<string, ISGManifestEntry>;
}

export interface PrerenderAppOptions {
  app: ViactApp;
  registry?: ModuleRegistry;
  clientEntryUrl?: string;
  cssUrls?: string[];
}

export async function prerenderApp(
  options: PrerenderAppOptions,
): Promise<PrerenderResult[]>;
export async function prerenderApp(
  options: PrerenderAppOptions & { withISGManifest: true },
): Promise<PrerenderAppResult>;
export async function prerenderApp(
  options: PrerenderAppOptions & { withISGManifest?: boolean },
): Promise<PrerenderResult[] | PrerenderAppResult> {
  const { resolveApp } = await import("./app.ts");
  const resolved = resolveApp(options.app);
  const results: PrerenderResult[] = [];
  const isgManifest: Record<string, ISGManifestEntry> = {};

  for (const route of resolved.routes) {
    if (route.render !== "ssg" && route.render !== "isg") continue;

    const paths = await collectSSGPaths(route, options.registry);

    for (const pathname of paths) {
      const url = new URL(pathname, "http://localhost");
      const request = new Request(url, { method: "GET" });

      const response = await handleViactRequest({
        app: options.app,
        request,
        registry: options.registry,
        clientEntryUrl: options.clientEntryUrl,
        cssUrls: options.cssUrls,
      });

      if (response.status !== 200) {
        console.warn(
          `  Warning: ${route.render!.toUpperCase()} route "${pathname}" returned status ${response.status}, skipping.`,
        );
        continue;
      }

      const html = await response.text();
      results.push({ path: pathname, html });

      if (route.render === "isg" && route.revalidate) {
        isgManifest[pathname] = { revalidate: route.revalidate };
      }
    }
  }

  if (options.withISGManifest) {
    return { pages: results, isgManifest };
  }

  return results;
}

async function collectSSGPaths(
  route: import("./types.ts").ResolvedRoute,
  registry?: ModuleRegistry,
): Promise<string[]> {
  const hasDynamicSegments = route.segments.some(
    (s) => s.type === "param" || s.type === "catchall",
  );

  if (!hasDynamicSegments) {
    return [route.path];
  }

  // Dynamic route — must export prerender() to enumerate paths
  const routeModule = await resolveRegistryModule<RouteModule>(
    registry?.routeModules,
    route.file,
  );

  if (!routeModule?.prerender) {
    console.warn(
      `  Warning: SSG route "${route.path}" has dynamic segments but no prerender() export, skipping.`,
    );
    return [];
  }

  return routeModule.prerender();
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}
