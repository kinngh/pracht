import type { ShellProps } from "viact";

export function Shell({ children }: ShellProps) {
  return (
    <div class="pages-shell">
      <header>
        <strong>Viact Pages</strong>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/blog/hello-world">Blog</a>
        </nav>
      </header>
      <main>{children}</main>
      <footer>File-system routing powered by viact.</footer>
    </div>
  );
}

export function head() {
  return {
    meta: [{ content: "width=device-width, initial-scale=1", name: "viewport" }],
    title: "Viact Pages Router",
  };
}
