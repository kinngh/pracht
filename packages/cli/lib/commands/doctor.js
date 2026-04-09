import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseFlags } from "../cli.js";
import {
  displayPath,
  hasPagesAppShell,
  listFilesRecursively,
  readProjectConfig,
  resolveProjectPath,
} from "../project.js";
import { extractRegistryEntries, extractRelativeModulePaths } from "../manifest.js";

export async function doctorCommand(args) {
  const options = parseFlags(args);
  const report = runDoctor(process.cwd());

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Pracht doctor (${report.mode} mode)`);
    for (const check of report.checks) {
      console.log(`${check.status.toUpperCase().padEnd(5)} ${check.message}`);
    }
    console.log(report.ok ? "\nNo blocking issues found." : "\nBlocking issues found.");
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

export function runDoctor(root) {
  const project = readProjectConfig(root);
  const checks = [];
  const configDisplayPath = project.configFile
    ? displayPath(root, project.configFile)
    : "vite.config.*";

  if (!project.configFile) {
    checks.push(createCheck("error", "Missing vite config."));
  } else {
    checks.push(createCheck("ok", `Found ${configDisplayPath}.`));
  }

  if (!project.hasPrachtPlugin) {
    checks.push(createCheck("error", "vite.config does not appear to register the pracht plugin."));
  } else {
    checks.push(createCheck("ok", "Vite config registers the pracht plugin."));
  }

  if (project.mode === "pages") {
    collectPagesDoctorChecks(project, checks);
  } else {
    collectManifestDoctorChecks(project, checks);
  }

  collectPackageDoctorChecks(project, checks);

  return {
    checks,
    configFile: project.configFile ? displayPath(root, project.configFile) : null,
    mode: project.mode,
    ok: !checks.some((check) => check.status === "error"),
  };
}

function collectManifestDoctorChecks(project, checks) {
  const manifestPath = resolveProjectPath(project.root, project.appFile);
  if (!existsSync(manifestPath)) {
    checks.push(createCheck("error", `App manifest is missing at ${project.appFile}.`));
    return;
  }

  checks.push(createCheck("ok", `Found app manifest at ${project.appFile}.`));

  const source = readFileSync(manifestPath, "utf-8");
  const routeCount = (source.match(/\broute\s*\(/g) ?? []).length;
  if (routeCount === 0) {
    checks.push(createCheck("warning", "No routes were found in the app manifest."));
  } else {
    checks.push(
      createCheck("ok", `App manifest defines ${routeCount} route${routeCount === 1 ? "" : "s"}.`),
    );
  }

  const shellEntries = extractRegistryEntries(source, "shells");
  const middlewareEntries = extractRegistryEntries(source, "middleware");
  if (shellEntries.length > 0) {
    checks.push(
      createCheck(
        "ok",
        `Registered ${shellEntries.length} shell${shellEntries.length === 1 ? "" : "s"}.`,
      ),
    );
  }
  if (middlewareEntries.length > 0) {
    checks.push(
      createCheck(
        "ok",
        `Registered ${middlewareEntries.length} middleware module${middlewareEntries.length === 1 ? "" : "s"}.`,
      ),
    );
  }

  const relativeModules = [...extractRelativeModulePaths(source)];
  const missingModules = relativeModules
    .map((modulePath) => ({
      display: modulePath,
      exists: existsSync(resolve(dirname(manifestPath), modulePath)),
    }))
    .filter((entry) => !entry.exists)
    .map((entry) => entry.display);

  if (missingModules.length > 0) {
    checks.push(
      createCheck(
        "error",
        `Manifest references missing files: ${missingModules.map((item) => JSON.stringify(item)).join(", ")}.`,
      ),
    );
  } else {
    checks.push(
      createCheck(
        "ok",
        `All ${relativeModules.length} manifest module path${relativeModules.length === 1 ? "" : "s"} resolve.`,
      ),
    );
  }
}

function collectPagesDoctorChecks(project, checks) {
  const pagesDir = resolveProjectPath(project.root, project.pagesDir);
  if (!existsSync(pagesDir)) {
    checks.push(createCheck("error", `Pages directory is missing at ${project.pagesDir}.`));
    return;
  }

  checks.push(createCheck("ok", `Found pages directory at ${project.pagesDir}.`));

  const pageFiles = listFilesRecursively(pagesDir).filter((file) =>
    /\.(ts|tsx|js|jsx|md|mdx)$/.test(file),
  );
  const routeFiles = pageFiles.filter((file) => !hasPagesAppShell(file));
  if (routeFiles.length === 0) {
    checks.push(createCheck("warning", "Pages router app does not contain any route files yet."));
  } else {
    checks.push(
      createCheck(
        "ok",
        `Found ${routeFiles.length} page route${routeFiles.length === 1 ? "" : "s"}.`,
      ),
    );
  }

  const hasAppShell = pageFiles.some((file) => hasPagesAppShell(file));
  if (!hasAppShell) {
    checks.push(createCheck("warning", "No `_app` shell was found in the pages directory."));
  } else {
    checks.push(createCheck("ok", "Found a pages-router `_app` shell."));
  }
}

function collectPackageDoctorChecks(project, checks) {
  const packageJsonPath = resolve(project.root, "package.json");
  if (!existsSync(packageJsonPath)) {
    checks.push(createCheck("warning", "No package.json found in the current app root."));
    return;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  if (!("@pracht/cli" in deps)) {
    checks.push(
      createCheck("warning", "`@pracht/cli` is not listed in package.json dependencies."),
    );
  }

  const adapterPackages = Object.keys(deps).filter((name) => name.startsWith("@pracht/adapter-"));
  if (adapterPackages.length === 0) {
    checks.push(
      createCheck("warning", "No built-in pracht adapter dependency was found in package.json."),
    );
  } else {
    checks.push(
      createCheck(
        "ok",
        `Found adapter dependency ${adapterPackages.map((name) => JSON.stringify(name)).join(", ")}.`,
      ),
    );
  }
}

function createCheck(status, message) {
  return { message, status };
}
