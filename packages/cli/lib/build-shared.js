import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_SECURITY_HEADERS, VERSION } from "./constants.js";

const ROUTE_STATE_REQUEST_HEADER = "x-pracht-route-state-request";

export function setDefaultSecurityHeaders(res, headers = {}) {
  for (const [key, value] of Object.entries({
    ...DEFAULT_SECURITY_HEADERS,
    ...headers,
  })) {
    res.setHeader(key, value);
  }
}

export function writeVercelBuildOutput({ functionName, regions, root, staticRoutes, isgRoutes }) {
  const outputDir = join(root, ".vercel/output");
  const staticDir = join(outputDir, "static");
  const functionDir = join(outputDir, "functions", `${functionName || "render"}.func`);

  rmSync(outputDir, { force: true, recursive: true });
  mkdirSync(outputDir, { recursive: true });
  cpSync(join(root, "dist/client"), staticDir, { recursive: true });
  cpSync(join(root, "dist/server"), functionDir, { recursive: true });

  writeFileSync(
    join(outputDir, "config.json"),
    `${JSON.stringify(createVercelOutputConfig({ functionName, staticRoutes, isgRoutes }), null, 2)}\n`,
    "utf-8",
  );
  writeFileSync(
    join(functionDir, ".vc-config.json"),
    `${JSON.stringify(createVercelFunctionConfig({ regions }), null, 2)}\n`,
    "utf-8",
  );

  return ".vercel/output";
}

function createVercelOutputConfig({ functionName, staticRoutes, isgRoutes }) {
  const target = `/${functionName || "render"}`;
  const routes = [
    {
      dest: target,
      has: [{ type: "header", key: ROUTE_STATE_REQUEST_HEADER, value: "1" }],
      src: "/(.*)",
    },
  ];

  for (const route of sortStaticRoutes(staticRoutes)) {
    routes.push({
      dest: routeToStaticHtmlPath(route),
      src: routeToRouteExpression(route),
    });
  }

  for (const route of isgRoutes) {
    routes.push({
      dest: target,
      src: routeToRouteExpression(route),
    });
  }

  routes.push({ handle: "filesystem" });
  routes.push({ dest: target, src: "/(.*)" });

  return {
    headers: [
      {
        headers: [
          {
            key: "permissions-policy",
            value:
              "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
          },
          { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
          { key: "x-content-type-options", value: "nosniff" },
          { key: "x-frame-options", value: "SAMEORIGIN" },
        ],
        source: "/(.*)",
      },
    ],
    framework: {
      version: VERSION,
    },
    routes,
    version: 3,
  };
}

function createVercelFunctionConfig({ regions }) {
  const config = {
    entrypoint: "server.js",
    runtime: "edge",
  };

  if (regions) {
    config.regions = regions;
  }

  return config;
}

function sortStaticRoutes(routes) {
  return [...new Set(routes)].sort((left, right) => right.length - left.length);
}

function routeToRouteExpression(route) {
  if (route === "/") {
    return "^/$";
  }

  return `^${escapeRegex(route)}/?$`;
}

function routeToStaticHtmlPath(route) {
  if (route === "/") {
    return "/index.html";
  }

  return `${route}/index.html`;
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}
