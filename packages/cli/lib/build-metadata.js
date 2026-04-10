import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MANIFEST_PATHS = ["dist/client/.vite/manifest.json", "dist/.vite/manifest.json"];

export function readClientBuildAssets(root = process.cwd()) {
  const manifestPath = MANIFEST_PATHS.map((candidate) => resolve(root, candidate)).find((path) =>
    existsSync(path),
  );

  if (!manifestPath) {
    return {
      clientEntryUrl: null,
      cssManifest: {},
      jsManifest: {},
    };
  }

  const rawManifest = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(rawManifest);
  const clientEntry = manifest["virtual:pracht/client"];

  function collectTransitiveDeps(key) {
    const css = new Set();
    const js = new Set();
    const visited = new Set();

    function collect(currentKey) {
      if (visited.has(currentKey)) return;
      visited.add(currentKey);

      const entry = manifest[currentKey];
      if (!entry) return;

      for (const cssFile of entry.css ?? []) {
        css.add(cssFile);
      }

      js.add(entry.file);

      for (const importedKey of entry.imports ?? []) {
        collect(importedKey);
      }
    }

    collect(key);
    return {
      css: [...css],
      js: [...js],
    };
  }

  const cssManifest = {};
  const jsManifest = {};

  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry.src) continue;

    const deps = collectTransitiveDeps(key);
    if (deps.css.length > 0) {
      cssManifest[key] = deps.css.map((file) => `/${file}`);
    }
    if (deps.js.length > 0) {
      jsManifest[key] = deps.js.map((file) => `/${file}`);
    }
  }

  return {
    clientEntryUrl: clientEntry ? `/${clientEntry.file}` : null,
    cssManifest,
    jsManifest,
  };
}
