import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createServer } from "vite";

import { handleCliError, parseFlags, printInspectHelp, requireOptionalString } from "../cli.js";
import { readClientBuildAssets } from "../build-metadata.js";
import { HTTP_METHODS } from "../constants.js";
import { readProjectConfig, resolveProjectPath } from "../project.js";

const INSPECT_TARGETS = new Set(["routes", "api", "build", "all"]);
const METHOD_ORDER = [...HTTP_METHODS];

export async function inspectCommand(args) {
  const options = parseFlags(args);
  const target = requireOptionalString(options, "target") ?? options._[0] ?? "all";

  if (options.help || target === "help") {
    printInspectHelp();
    return;
  }

  if (!INSPECT_TARGETS.has(target)) {
    handleCliError(new Error(`Unknown inspect target: ${target}`), { json: !!options.json });
  }

  const report = await runInspect(process.cwd(), { target });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printInspectReport(report);
}

export async function runInspect(root, { target = "all" } = {}) {
  const project = readProjectConfig(root);

  if (!project.configFile) {
    throw new Error(
      "Missing vite config. `pracht inspect` requires a project with pracht configured.",
    );
  }

  if (!project.hasPrachtPlugin) {
    throw new Error("vite.config does not appear to register the pracht plugin.");
  }

  if (project.mode === "manifest") {
    const manifestPath = resolveProjectPath(project.root, project.appFile);
    try {
      readFileSync(manifestPath, "utf-8");
    } catch {
      throw new Error(`App manifest is missing at ${project.appFile}.`);
    }
  }

  const server = await createServer({
    root,
    logLevel: "silent",
    server: {
      middlewareMode: true,
    },
  });

  try {
    const serverModule = await server.ssrLoadModule("virtual:pracht/server");
    const report = {
      mode: project.mode,
    };

    if (target === "routes" || target === "all") {
      report.routes = serializeRoutes(serverModule.resolvedApp.routes);
    }

    if (target === "api" || target === "all") {
      report.api = await Promise.all(
        serverModule.apiRoutes.map(async (route) => ({
          file: route.file,
          methods: await detectApiMethods(server, root, route.file),
          path: route.path,
        })),
      );
    }

    if (target === "build" || target === "all") {
      const buildAssets = readClientBuildAssets(root);
      report.build = {
        adapterTarget: serverModule.buildTarget,
        clientEntryUrl: buildAssets.clientEntryUrl,
        cssManifest: buildAssets.cssManifest,
        jsManifest: buildAssets.jsManifest,
      };
    }

    return report;
  } finally {
    await server.close();
  }
}

function serializeRoutes(routes) {
  return routes.map((route) => ({
    file: route.file,
    id: route.id,
    loaderFile: route.loaderFile ?? null,
    middleware: route.middleware,
    path: route.path,
    render: route.render ?? null,
    revalidate: route.revalidate ?? null,
    shell: route.shell ?? null,
    shellFile: route.shellFile ?? null,
  }));
}

async function detectApiMethods(server, root, file) {
  const resolvedFile = resolve(root, `.${file}`);
  const source = readFileSync(resolvedFile, "utf-8");

  // Use module evaluation first so re-exported handlers are reflected too.
  try {
    const module = await server.ssrLoadModule(file);
    return METHOD_ORDER.filter((method) => typeof module[method] === "function");
  } catch {
    return METHOD_ORDER.filter((method) =>
      new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${method}\\b`).test(source),
    );
  }
}

function printInspectReport(report) {
  console.log(`Pracht inspect (${report.mode} mode)`);

  if (report.routes) {
    console.log("\nRoutes");
    for (const route of report.routes) {
      console.log(
        `  ${route.path}  id=${route.id}  render=${route.render ?? "n/a"}  file=${route.file}`,
      );
    }
  }

  if (report.api) {
    console.log("\nAPI");
    if (report.api.length === 0) {
      console.log("  No API routes found.");
    } else {
      for (const route of report.api) {
        const methods = route.methods.length > 0 ? route.methods.join(",") : "none";
        console.log(`  ${route.path}  methods=${methods}  file=${route.file}`);
      }
    }
  }

  if (report.build) {
    console.log("\nBuild");
    console.log(`  adapterTarget=${report.build.adapterTarget}`);
    console.log(`  clientEntryUrl=${report.build.clientEntryUrl ?? "null"}`);
    console.log(`  cssManifestKeys=${Object.keys(report.build.cssManifest).length}`);
    console.log(`  jsManifestKeys=${Object.keys(report.build.jsManifest).length}`);
  }
}
