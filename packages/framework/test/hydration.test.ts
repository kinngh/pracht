// @vitest-environment jsdom
import { h, hydrate, render } from "preact";
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
});
