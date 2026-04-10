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

  it("returns true after hydration completes", async () => {
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

    // Complete hydration first
    function First() {
      return h("div", null, "hello");
    }
    markHydrating();
    hydrate(h(First, null), scratch);
    await flush();

    // Now mount a new component — it should start hydrated
    const values: boolean[] = [];
    function Second() {
      values.push(useIsHydrated());
      return h("div", null, "world");
    }
    render(h(Second, null), scratch);

    expect(values[0]).toBe(true);
  });

  it("root reports hydrated while a Suspense subtree is still suspended", async () => {
    // Simulate: <Root> uses useIsHydrated, wraps a <Suspense> with a lazy child.
    // The root should report hydrated after mount (via useEffect) even though
    // the lazy child inside the Suspense boundary hasn't resolved yet.
    scratch.innerHTML = "<div><div>fallback</div></div>";

    let resolvePromise!: () => void;
    const promise = new Promise<void>((r) => {
      resolvePromise = r;
    });

    let threw = false;
    function LazyChild() {
      if (!threw) {
        threw = true;
        throw promise;
      }
      return h("div", null, "loaded");
    }

    const rootValues: boolean[] = [];
    function Root() {
      rootValues.push(useIsHydrated());
      return h(Suspense as any, { fallback: h("div", null, "fallback") }, h(LazyChild, null));
    }

    markHydrating();
    hydrate(h(Root, null), scratch);

    // During hydration render, hook returns false
    expect(rootValues[0]).toBe(false);

    await flush();

    // Root's useEffect has fired — it reports hydrated even though
    // the Suspense subtree is still waiting for its promise.
    expect(rootValues[rootValues.length - 1]).toBe(true);

    // Resolve the lazy child
    resolvePromise();
    await flush();

    // Root stays hydrated
    expect(rootValues[rootValues.length - 1]).toBe(true);
  });
});
