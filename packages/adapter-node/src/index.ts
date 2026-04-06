import type { IncomingMessage, ServerResponse } from "node:http";

import {
  handleViactRequest,
  type HandleViactRequestOptions,
  type ModuleRegistry,
  type ViactApp,
} from "viact";

export interface NodeAdapterContextArgs {
  request: Request;
  req: IncomingMessage;
  res: ServerResponse;
}

export interface NodeAdapterOptions<TContext = unknown> {
  app: ViactApp;
  registry?: ModuleRegistry;
  staticDir?: string;
  viteManifest?: unknown;
  createContext?: (
    args: NodeAdapterContextArgs,
  ) => TContext | Promise<TContext>;
}

export interface NodeServerEntryModuleOptions {
  appImportPath?: string;
  port?: number;
}

export function createNodeRequestHandler<TContext = unknown>(
  options: NodeAdapterOptions<TContext>,
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const request = await createWebRequest(req);
    const context = options.createContext
      ? await options.createContext({ request, req, res })
      : undefined;

    const response = await handleViactRequest({
      app: options.app,
      context,
      registry: options.registry,
      request,
    } satisfies HandleViactRequestOptions<TContext>);

    await writeWebResponse(res, response);
  };
}

export function createNodeServerEntryModule(
  options: NodeServerEntryModuleOptions = {},
): string {
  const appImportPath = options.appImportPath ?? "/src/routes.ts";
  const port = options.port ?? 3000;

  return [
    'import { createServer } from "node:http";',
    'import { createNodeRequestHandler } from "@viact/adapter-node";',
    `import { app } from ${JSON.stringify(appImportPath)};`,
    "",
    "const handler = createNodeRequestHandler({ app });",
    "const server = createServer(handler);",
    `server.listen(${port});`,
    "",
  ].join("\n");
}

async function createWebRequest(req: IncomingMessage): Promise<Request> {
  const protocol = getFirstHeaderValue(req.headers["x-forwarded-proto"]) ?? "http";
  const host = getFirstHeaderValue(req.headers.host) ?? "localhost";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  const method = req.method ?? "GET";
  const headers = createHeaders(req.headers);
  const init: RequestInit = {
    headers,
    method,
  };

  if (!BODYLESS_METHODS.has(method.toUpperCase())) {
    const body = await readRequestBody(req);
    if (body.byteLength > 0) {
      const exactBody = new Uint8Array(body.byteLength);
      exactBody.set(body);
      init.body = exactBody.buffer;
    }
  }

  return new Request(url, init);
}

function createHeaders(headers: IncomingMessage["headers"]): Headers {
  const result = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "undefined") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        result.append(key, entry);
      }

      continue;
    }

    result.set(key, value);
  }

  return result;
}

async function readRequestBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of req) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function writeWebResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

function getFirstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
