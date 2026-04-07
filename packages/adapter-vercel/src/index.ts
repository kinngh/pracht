import type { ViactAdapter } from "@viact/vite-plugin";
import {
  handleViactRequest,
  type HandleViactRequestOptions,
  type ModuleRegistry,
  type ResolvedApiRoute,
  type ViactApp,
} from "viact";

export interface VercelExecutionContext {
  waitUntil?(promise: Promise<unknown>): void;
  [key: string]: unknown;
}

export interface VercelContextArgs<
  TVercelContext extends VercelExecutionContext = VercelExecutionContext,
> {
  request: Request;
  context: TVercelContext;
}

export interface VercelAdapterOptions<
  TVercelContext extends VercelExecutionContext = VercelExecutionContext,
  TContext = TVercelContext,
> {
  app: ViactApp;
  registry?: ModuleRegistry;
  apiRoutes?: ResolvedApiRoute[];
  clientEntryUrl?: string;
  cssManifest?: Record<string, string[]>;
  jsManifest?: Record<string, string[]>;
  createContext?: (args: VercelContextArgs<TVercelContext>) => TContext | Promise<TContext>;
}

export interface VercelServerEntryModuleOptions {
  functionName?: string;
  regions?: string | string[];
}

export function createVercelEdgeHandler<
  TVercelContext extends VercelExecutionContext = VercelExecutionContext,
  TContext = TVercelContext,
>(options: VercelAdapterOptions<TVercelContext, TContext>) {
  return async (request: Request, context: TVercelContext): Promise<Response> => {
    const viactContext = options.createContext
      ? await options.createContext({ request, context })
      : (context as unknown as TContext);

    return handleViactRequest({
      app: options.app,
      registry: options.registry,
      request,
      context: viactContext,
      apiRoutes: options.apiRoutes,
      clientEntryUrl: options.clientEntryUrl,
      cssManifest: options.cssManifest,
      jsManifest: options.jsManifest,
    } satisfies HandleViactRequestOptions<TContext>);
  };
}

export function createVercelServerEntryModule(
  options: VercelServerEntryModuleOptions = {},
): string {
  const functionName = options.functionName ?? "render";
  const regions = options.regions;

  return [
    `export const vercelFunctionName = ${JSON.stringify(functionName)};`,
    `export const vercelRegions = ${JSON.stringify(regions ?? null)};`,
    "",
    "export default async function handle(request, context) {",
    "  return handleViactRequest({",
    "    app: resolvedApp,",
    "    registry,",
    "    request,",
    "    context,",
    "    apiRoutes,",
    "    clientEntryUrl: clientEntryUrl ?? undefined,",
    "    cssManifest,",
    "    jsManifest,",
    "  });",
    "}",
    "",
  ].join("\n");
}

/**
 * Create a viact adapter for Vercel Edge Functions.
 *
 * ```ts
 * import { vercelAdapter } from "@viact/adapter-vercel";
 * viact({ adapter: vercelAdapter() })
 * ```
 */
export function vercelAdapter(
  options: VercelServerEntryModuleOptions = {},
): ViactAdapter {
  return {
    id: "vercel",
    serverImports:
      'import { handleViactRequest, resolveApp, resolveApiRoutes } from "viact";',
    createServerEntryModule() {
      return createVercelServerEntryModule(options);
    },
  };
}
