// @vitest-environment jsdom
import { createRef, h, render } from "preact";
import { afterEach, describe, expect, it } from "vitest";

import { forwardRef } from "../src/forwardRef.ts";

describe("forwardRef", () => {
  let scratch: HTMLDivElement;

  afterEach(() => {
    if (scratch) {
      render(null, scratch);
      scratch.remove();
    }
  });

  function setupScratch() {
    scratch = document.createElement("div");
    document.body.appendChild(scratch);
    return scratch;
  }

  it("forwards ref to the underlying DOM element", () => {
    const ref = createRef();
    const Comp = forwardRef<{ value: string }>((props, ref) => {
      return h("div", { ref }, props.value);
    });

    render(h(Comp, { ref, value: "hello" }), setupScratch());
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current!.textContent).toBe("hello");
  });

  it("passes null ref when no ref is provided", () => {
    let receivedRef: any = "not called";
    const Comp = forwardRef((_, ref) => {
      receivedRef = ref;
      return h("span", null);
    });

    render(h(Comp, null), setupScratch());
    expect(receivedRef).toBeNull();
  });

  it("strips ref from props passed to the wrapped component", () => {
    let receivedProps: any;
    const ref = createRef();
    const Comp = forwardRef<{ name: string }>((props, _ref) => {
      receivedProps = props;
      return h("div", null);
    });

    render(h(Comp, { ref, name: "test" }), setupScratch());
    expect(receivedProps).toEqual({ name: "test" });
    expect(receivedProps).not.toHaveProperty("ref");
  });

  it("sets displayName from the wrapped function name", () => {
    function MyInput(_props: any, _ref: any) {
      return h("input", null);
    }
    const Comp = forwardRef(MyInput);
    expect(Comp.displayName).toBe("ForwardRef(MyInput)");
  });

  it("sets displayName from displayName property if available", () => {
    const fn = (_props: any, _ref: any) => h("input", null);
    fn.displayName = "CustomName";
    const Comp = forwardRef(fn);
    expect(Comp.displayName).toBe("ForwardRef(CustomName)");
  });

  it("marks the component with __f flag", () => {
    const Comp = forwardRef(() => h("div", null));
    expect((Comp as any).__f).toBe(true);
  });
});
