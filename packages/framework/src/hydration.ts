import { options } from "preact";
import { useEffect, useState } from "preact/hooks";

let _hydrating = false;
let _suspensionCount = 0;
let _hydrated = false;

// options.__e (_catchError) — count thrown promises during hydration
const oldCatchError = (options as any).__e;
(options as any).__e = (err: any, newVNode: any, oldVNode: any, errorInfo?: any) => {
  if (_hydrating && !_hydrated && err && err.then) {
    _suspensionCount++;
    let settled = false;
    const onSettled = () => {
      if (settled) return;
      settled = true;
      _suspensionCount--;
    };
    err.then(onSettled, onSettled);
  }
  if (oldCatchError) oldCatchError(err, newVNode, oldVNode, errorInfo);
};

// options.diffed — after a full render cycle, if nothing is suspended we're done
const oldDiffed = (options as any).diffed;
(options as any).diffed = (vnode: any) => {
  if (_hydrating && !_hydrated && _suspensionCount <= 0) {
    _hydrated = true;
    _hydrating = false;
  }
  if (oldDiffed) oldDiffed(vnode);
};

/**
 * Mark the start of a hydration pass. Call this right before `hydrate()`.
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
