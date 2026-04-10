import { options } from "preact";
import { useEffect, useState } from "preact/hooks";

// Preact internal flags
const MODE_HYDRATE = 1 << 5;

// ---------------------------------------------------------------------------
// Global hydration tracking state
// ---------------------------------------------------------------------------

let _hydrating = false;
let _suspensionCount = 0;
let _hydrated = false;

// ---------------------------------------------------------------------------
// options.__b (_diff) — detect when we're diffing hydration vnodes
// ---------------------------------------------------------------------------

const oldDiff = (options as any).__b;
(options as any).__b = (vnode: any) => {
  // __u is the mangled _flags property on the vnode.
  // During hydration Preact sets MODE_HYDRATE on vnodes being diffed.
  if (!_hydrated && vnode.__u && vnode.__u & MODE_HYDRATE) {
    _hydrating = true;
  }
  if (oldDiff) oldDiff(vnode);
};

// ---------------------------------------------------------------------------
// options.__e (_catchError) — track thrown promises during hydration
// ---------------------------------------------------------------------------

const oldCatchError = (options as any).__e;
(options as any).__e = (err: any, newVNode: any, oldVNode: any, errorInfo?: any) => {
  if (_hydrating && !_hydrated && err && err.then) {
    _suspensionCount++;
    let settled = false;
    const onSettled = () => {
      if (settled) return;
      settled = true;
      _suspensionCount--;
      if (_suspensionCount <= 0) {
        _suspensionCount = 0;
        _hydrated = true;
        _hydrating = false;
      }
    };
    err.then(onSettled, onSettled);
  }
  if (oldCatchError) oldCatchError(err, newVNode, oldVNode, errorInfo);
};

// ---------------------------------------------------------------------------
// options.diffed — when no suspensions are pending, hydration is done
// ---------------------------------------------------------------------------

const oldDiffed = (options as any).diffed;
(options as any).diffed = (vnode: any) => {
  if (_hydrating && !_hydrated && _suspensionCount <= 0) {
    _hydrated = true;
    _hydrating = false;
  }
  if (oldDiffed) oldDiffed(vnode);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mark the start of a hydration pass. Call this right before `hydrate()`.
 * This ensures the global flag is set even before the first `_diff` fires.
 */
export function markHydrating(): void {
  if (!_hydrated) {
    _hydrating = true;
  }
}

/**
 * Returns `true` once the initial hydration (including all Suspense
 * boundaries) has fully resolved. During SSR and hydration this returns
 * `false`.
 *
 * During hydration, server-rendered content stays visible in the DOM
 * while lazy components load. This hook waits for every suspended promise
 * to settle before flipping to `true`, so the page is truly interactive.
 */
export function useIsHydrated(): boolean {
  const [hydrated, setHydrated] = useState(_hydrated);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}

/** @internal Reset module state for tests. */
export function _resetForTesting(): void {
  _hydrating = false;
  _suspensionCount = 0;
  _hydrated = false;
}
