import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

import { ensureTrailingNewline } from "./cli.js";
import { PROJECT_DEFAULTS } from "./constants.js";

export function readProjectConfig(root) {
  const configFile = findConfigFile(root);
  const rawConfig = configFile ? readFileSync(configFile, "utf-8") : "";
  const config = {
    ...PROJECT_DEFAULTS,
    configFile,
    hasPrachtPlugin: /\bpracht\s*\(/.test(rawConfig),
    rawConfig,
    root,
  };

  for (const key of Object.keys(PROJECT_DEFAULTS)) {
    const value = readQuotedConfigValue(rawConfig, key);
    if (typeof value === "string") {
      config[key] = normalizeConfigPath(value);
    }
  }

  config.mode = config.pagesDir ? "pages" : "manifest";
  return config;
}

export function resolveProjectPath(root, configPath) {
  return resolve(root, `.${configPath}`);
}

export function resolveScopedFile(root, configDir, fileName) {
  return resolve(resolveProjectPath(root, configDir), fileName);
}

export function resolveRouteModulePath(project, routePath, extension) {
  const segments = segmentsFromRoutePath(routePath);
  const relativePath =
    segments.length === 0 ? `index${extension}` : `${segments.join("/")}${extension}`;
  const absolutePath = resolve(resolveProjectPath(project.root, project.routesDir), relativePath);
  return { absolutePath, relativePath };
}

export function resolvePagesRouteModulePath(project, routePath, extension) {
  const segments = segmentsFromRoutePath(routePath);
  const relativePath =
    segments.length === 0 ? `index${extension}` : `${segments.join("/")}${extension}`;
  const absolutePath = resolve(resolveProjectPath(project.root, project.pagesDir), relativePath);
  return { absolutePath, relativePath };
}

export function resolveApiModulePath(project, endpointPath) {
  const segments = segmentsFromApiPath(endpointPath);
  const relativePath = segments.length === 0 ? "index.ts" : `${segments.join("/")}.ts`;
  const absolutePath = resolve(resolveProjectPath(project.root, project.apiDir), relativePath);
  return { absolutePath, relativePath };
}

export function displayPath(root, filePath) {
  return relative(root, filePath) || ".";
}

export function writeGeneratedFile(filePath, source) {
  if (existsSync(filePath)) {
    throw new Error(`Refusing to overwrite existing file ${filePath}.`);
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, ensureTrailingNewline(source), "utf-8");
}

export function assertFileExists(filePath, message) {
  if (!existsSync(filePath)) {
    throw new Error(message);
  }
}

export function listFilesRecursively(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

export function hasPagesAppShell(filePath) {
  return /^_app\.(ts|tsx|js|jsx)$/.test(basename(filePath));
}

function findConfigFile(root) {
  for (const name of [
    "vite.config.ts",
    "vite.config.mts",
    "vite.config.js",
    "vite.config.mjs",
    "vite.config.cjs",
    "vite.config.cts",
  ]) {
    const file = resolve(root, name);
    if (existsSync(file)) return file;
  }
  return null;
}

function readQuotedConfigValue(source, key) {
  if (!source) return null;
  const pattern = new RegExp(`${key}\\s*:\\s*(["'\\\`])([^"'\\\`]+)\\1`);
  const match = source.match(pattern);
  return match ? match[2] : null;
}

function normalizeConfigPath(value) {
  if (!value) return value;
  return value.startsWith("/") ? value : `/${value}`;
}

function segmentsFromRoutePath(routePath) {
  return routePath
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(":")) return `[${segment.slice(1)}]`;
      if (segment === "*") return "[...slug]";
      return segment;
    });
}

function segmentsFromApiPath(endpointPath) {
  return endpointPath
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(":")) return `[${segment.slice(1)}]`;
      if (segment === "*") return "[...slug]";
      return segment;
    });
}
