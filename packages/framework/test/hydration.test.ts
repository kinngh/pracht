// @vitest-environment jsdom
import { h, hydrate, render } from "preact";
import { Suspense } from "preact-suspense";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { markHydrating, useIsHydrated, _resetForTesting } from "../src/hydration.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let scratch: HTMLDivElement;

function setupScratch() {
  scratch = document.createElement("div");
  document.body.appendChild(scratch);
  return scratch;
}

/** Flush microtasks, requestAnimationFrame, and Preact re-renders. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await Promise.resolve();
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useIsHydrated", () => {
  beforeEach(() => {
    _resetForTesting();
    setupScratch();
  });

  afterEach(() => {
    if (scratch) {
      render(null, scratch);
      scratch.remove();
    }
  });

  it("returns false during the initial hydration render", () => {
    scratch.innerHTML = "<div>hello</div>";

    const values: boolean[] = [];
    function App() {
      values.push(useIsHydrated());
      return h("div", null, "hello");
    }

    markHydrating();
    hydrate(h(App, null), scratch);

    expect(values[0]).toBe(false);
  });

  it("returns true after hydration completes (no suspensions)", async () => {
    scratch.innerHTML = "<div>hello</div>";

    const values: boolean[] = [];
    function App() {
      values.push(useIsHydrated());
      return h("div", null, "hello");
    }

    markHydrating();
    hydrate(h(App, null), scratch);
    await flush();

    expect(values[values.length - 1]).toBe(true);
  });

  it("returns false when markHydrating was never called", () => {
    const values: boolean[] = [];
    function App() {
      values.push(useIsHydrated());
      return h("div", null, "hello");
    }

    render(h(App, null), scratch);
    expect(values[0]).toBe(false);
  });

  it("starts true for components mounting after hydration finished", async () => {
    scratch.innerHTML = "<div>hello</div>";

    function First() {
      return h("div", null, "hello");
    }
    markHydrating();
    hydrate(h(First, null), scratch);
    await flush();

    // Mount a new component after hydration — should start with true
    const values: boolean[] = [];
    function Second() {
      values.push(useIsHydrated());
      return h("div", null, "world");
    }
    render(h(Second, null), scratch);

    expect(values[0]).toBe(true);
  });

  it("tracks suspension count during hydration", async () => {
    // SSR rendered the *resolved* content — that's what sits in the DOM.
    // During hydration the lazy component throws a promise; Suspense keeps
    // the server HTML alive (no fallback shown). The global _hydrated flag
    // stays false until the promise settles, so components that mount
    // later (e.g. via lazy()) get the correct initial value.
    scratch.innerHTML = "<div><div>Hello</div></div>";

    let resolvePromise!: () => void;
    const promise = new Promise<void>((r) => {
      resolvePromise = r;
    });

    let threw = false;
    const lazyValues: boolean[] = [];
    function LazyChild() {
      if (!threw) {
        threw = true;
        throw promise;
      }
      lazyValues.push(useIsHydrated());
      return h("div", null, "Hello");
    }

    const rootValues: boolean[] = [];
    function Root() {
      rootValues.push(useIsHydrated());
      return h(Suspense as any, { fallback: h("div", null, "Loading...") }, h(LazyChild, null));
    }

    markHydrating();
    hydrate(h(Root, null), scratch);

    // During hydration render — _hydrated is false so useState initialises to false
    expect(rootValues[0]).toBe(false);
    // LazyChild threw, so it never called the hook yet
    expect(lazyValues).toHaveLength(0);

    await flush();

    // Root's useEffect has fired
    expect(rootValues[rootValues.length - 1]).toBe(true);

    // Server HTML is still visible (Suspense didn't swap to fallback)
    expect(scratch.innerHTML).toContain("Hello");

    // Resolve the lazy component — LazyChild renders for the first time,
    // _hydrated is still false at that point so useState initialises to false.
    resolvePromise();
    await flush();

    // LazyChild's first render saw _hydrated=false, then useEffect flipped it
    expect(lazyValues[0]).toBe(false);
    expect(lazyValues[lazyValues.length - 1]).toBe(true);
  });
});
