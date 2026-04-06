import { createContext, h } from "preact";
import { hydrate, render } from "preact";
import { useContext } from "preact/hooks";
import type { VNode } from "preact";

import { matchAppRoute } from "./app.ts";
import type { ResolvedViactApp, RouteMatch } from "./types.ts";
import { ViactRuntimeProvider } from "./runtime.ts";
import type { ViactHydrationState } from "./runtime.ts";

declare global {
  interface Window {
    __VIACT_ROUTER_READY__?: boolean;
  }
}

type ModuleMap = Record<string, () => Promise<any>>;

export type NavigateFn = (
  to: string,
  options?: { replace?: boolean },
) => Promise<void>;

const NavigateContext = createContext<NavigateFn>(async () => {});

export function useNavigate(): NavigateFn {
  return useContext(NavigateContext);
}

export interface InitClientRouterOptions {
  app: ResolvedViactApp;
  routeModules: ModuleMap;
  shellModules: ModuleMap;
  initialState: ViactHydrationState;
  root: HTMLElement;
  findModuleKey: (modules: ModuleMap, file: string) => string | null;
}

export async function initClientRouter(
  options: InitClientRouterOptions,
): Promise<void> {
  const { app, routeModules, shellModules, root, findModuleKey } = options;

  // ------------------------------------------------------------------
  // Build a Preact VNode tree for a matched route
  // ------------------------------------------------------------------

  async function buildRouteTree(
    match: RouteMatch,
    data: unknown,
  ): Promise<VNode<any> | null> {
    const routeKey = findModuleKey(routeModules, match.route.file);
    if (!routeKey) return null;
    const routeMod = await routeModules[routeKey]();
    if (!routeMod.Component) return null;

    let Shell: any = null;
    if (match.route.shellFile) {
      const shellKey = findModuleKey(shellModules, match.route.shellFile);
      if (shellKey) {
        const shellMod = await shellModules[shellKey]();
        Shell = shellMod.Shell;
      }
    }

    const Component = routeMod.Component;
    const props = { data, params: match.params };
    const componentTree = Shell
      ? h(Shell, null, h(Component, props))
      : h(Component, props);

    return h(
      NavigateContext.Provider as any,
      { value: navigate },
      h(ViactRuntimeProvider as any, { data }, componentTree),
    );
  }

  // ------------------------------------------------------------------
  // Navigate to a new pathname
  // ------------------------------------------------------------------

  async function navigate(
    to: string,
    opts?: { replace?: boolean; _popstate?: boolean },
  ): Promise<void> {
    const match = matchAppRoute(app, to);
    if (!match) {
      // No client route — fall back to full page load
      window.location.href = to;
      return;
    }

    // Fetch route state from server
    let data: unknown;
    try {
      const response = await fetch(to, {
        headers: { "x-viact-route-state-request": "1" },
        redirect: "manual",
      });

      // Handle redirects — opaqueredirect or 3xx with Location header
      if (
        response.type === "opaqueredirect" ||
        (response.status >= 300 && response.status < 400)
      ) {
        const location = response.headers.get("location");
        if (location) {
          await navigate(location, opts);
          return;
        }
        window.location.href = to;
        return;
      }

      const json = await response.json();
      data = json.data;
    } catch {
      // Network error — full page load as fallback
      window.location.href = to;
      return;
    }

    // Update browser history
    if (!opts?._popstate) {
      if (opts?.replace) {
        history.replaceState(null, "", to);
      } else {
        history.pushState(null, "", to);
      }
    }

    // Render the new route
    const tree = await buildRouteTree(match, data);
    if (tree) {
      render(tree, root);
      window.scrollTo(0, 0);
    }
  }

  // ------------------------------------------------------------------
  // Initial hydration — includes NavigateContext so useNavigate works
  // ------------------------------------------------------------------

  const initialMatch = matchAppRoute(app, options.initialState.url);
  if (initialMatch) {
    const tree = await buildRouteTree(initialMatch, options.initialState.data);
    if (tree) {
      hydrate(tree, root);
    }
  }

  // ------------------------------------------------------------------
  // Global click interception for <a> elements
  // ------------------------------------------------------------------

  document.addEventListener("click", (e: MouseEvent) => {
    const anchor = (e.target as Element).closest?.("a");
    if (!anchor) return;

    // Skip modified clicks (new tab, etc.)
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;

    // Skip if target opens a new window
    const target = anchor.getAttribute("target");
    if (target && target !== "_self") return;

    // Skip download links
    if (anchor.hasAttribute("download")) return;

    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) return;

    // Resolve relative URLs
    let url: URL;
    try {
      url = new URL(href, window.location.origin);
    } catch {
      return;
    }

    // Skip external origins
    if (url.origin !== window.location.origin) return;

    e.preventDefault();
    navigate(url.pathname + url.search);
  });

  // ------------------------------------------------------------------
  // Back / forward navigation
  // ------------------------------------------------------------------

  window.addEventListener("popstate", () => {
    navigate(window.location.pathname + window.location.search, {
      _popstate: true,
    });
  });

  window.__VIACT_ROUTER_READY__ = true;
}
