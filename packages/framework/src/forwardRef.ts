import { options } from "preact";
import type { FunctionComponent } from "preact";

let oldDiffHook = (options as any).__b;
(options as any).__b = (vnode: any) => {
  if (vnode.type && vnode.type.__f && vnode.ref) {
    vnode.props.ref = vnode.ref;
    vnode.ref = null;
  }
  if (oldDiffHook) oldDiffHook(vnode);
};

/**
 * Pass ref down to a child. This is mainly used in libraries with HOCs that
 * wrap components. Using `forwardRef` there is an easy way to get a reference
 * of the wrapped component instead of one of the wrapper itself.
 */
export function forwardRef<P = {}>(
  fn: (props: P, ref: any) => any,
): FunctionComponent<P & { ref?: any }> {
  function Forwarded(props: any) {
    const clone = { ...props };
    delete clone.ref;
    return fn(clone, props.ref || null);
  }

  Forwarded.__f = true;
  Forwarded.displayName = "ForwardRef(" + (fn.displayName || fn.name) + ")";
  return Forwarded as any;
}
