import { CodeBlock } from "../../components/CodeBlock";

export function head() {
  return { title: "Testing — Recipes — viact docs" };
}

export function Component() {
  return (
    <div class="doc-page">
      <div class="breadcrumb">
        <a href="/">viact</a>
        <span class="breadcrumb-sep">/</span>
        <a href="/docs/getting-started">Docs</a>
        <span class="breadcrumb-sep">/</span>
        <span>Testing</span>
      </div>

      <h1 class="doc-title">Testing</h1>
      <p class="doc-lead">
        Test your viact app at every level — unit test loaders and actions with
        Vitest, and run full E2E tests with Playwright to verify rendering,
        navigation, and hydration.
      </p>

      <h2>Recommended Setup</h2>
      <p>
        Viact apps are built on Vite, so <strong>Vitest</strong> is the natural
        choice for unit and integration tests. For E2E browser tests, use{" "}
        <strong>Playwright</strong>.
      </p>
      <CodeBlock
        code={`# Install test dependencies
pnpm add -D vitest @playwright/test`}
      />

      <div class="doc-sep" />

      <h2>Unit Testing Loaders &amp; Actions</h2>
      <p>
        Loaders and actions are plain async functions that take a{" "}
        <code>Request</code> and return data. Test them directly — no framework
        bootstrap needed.
      </p>

      <h3>Testing a loader</h3>
      <CodeBlock
        filename="src/routes/dashboard.test.ts"
        code={`import { describe, it, expect, vi } from "vitest";
import { loader } from "./dashboard";

describe("dashboard loader", () => {
  it("returns projects for the authenticated user", async () => {
    const request = new Request("http://localhost/dashboard", {
      headers: { "x-user-id": "user-1" },
    });

    const data = await loader({
      request,
      params: {},
      url: new URL(request.url),
      signal: AbortSignal.timeout(5000),
    });

    expect(data.projects).toBeDefined();
    expect(data.projects.length).toBeGreaterThan(0);
  });

  it("throws 401 when no user header is present", async () => {
    const request = new Request("http://localhost/dashboard");

    await expect(
      loader({
        request,
        params: {},
        url: new URL(request.url),
        signal: AbortSignal.timeout(5000),
      }),
    ).rejects.toThrow();
  });
});`}
      />

      <h3>Testing an action</h3>
      <CodeBlock
        filename="src/routes/contact.test.ts"
        code={`import { describe, it, expect } from "vitest";
import { action } from "./contact";

function makeFormRequest(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return new Request("http://localhost/contact", {
    method: "POST",
    body: form,
    headers: { origin: "http://localhost" },
  });
}

describe("contact action", () => {
  it("validates required fields", async () => {
    const result = await action({
      request: makeFormRequest({ name: "", email: "", message: "" }),
      params: {},
      url: new URL("http://localhost/contact"),
      signal: AbortSignal.timeout(5000),
    });

    expect(result.ok).toBe(false);
    expect(result.data.errors.name).toBeDefined();
    expect(result.data.errors.email).toBeDefined();
  });

  it("succeeds with valid input", async () => {
    const result = await action({
      request: makeFormRequest({
        name: "Alice",
        email: "alice@example.com",
        message: "Hello!",
      }),
      params: {},
      url: new URL("http://localhost/contact"),
      signal: AbortSignal.timeout(5000),
    });

    expect(result.ok).toBe(true);
  });
});`}
      />

      <div class="doc-sep" />

      <h2>Testing Middleware</h2>
      <p>
        Middleware functions can be tested in isolation. They either return{" "}
        <code>void</code> (continue) or an object with <code>redirect</code>.
      </p>
      <CodeBlock
        filename="src/middleware/auth.test.ts"
        code={`import { describe, it, expect } from "vitest";
import { middleware } from "./auth";

describe("auth middleware", () => {
  it("redirects when no session cookie is present", async () => {
    const request = new Request("http://localhost/dashboard");
    const result = await middleware({
      request,
      url: new URL(request.url),
      params: {},
      signal: AbortSignal.timeout(5000),
    });

    expect(result).toEqual({
      redirect: expect.stringContaining("/login"),
    });
  });

  it("continues when session is valid", async () => {
    const request = new Request("http://localhost/dashboard", {
      headers: { cookie: "session=valid-token-here" },
    });

    const result = await middleware({
      request,
      url: new URL(request.url),
      params: {},
      signal: AbortSignal.timeout(5000),
    });

    expect(result).toBeUndefined();
  });
});`}
      />

      <div class="doc-sep" />

      <h2>Testing the Request Pipeline</h2>
      <p>
        For integration tests, use <code>handleViactRequest()</code> to test the
        full server pipeline — middleware, loaders, rendering — without a
        browser:
      </p>
      <CodeBlock
        filename="test/integration.test.ts"
        code={`import { describe, it, expect } from "vitest";
import { handleViactRequest, resolveApp } from "viact";

// Build a test app with mock modules
const app = resolveApp({
  shells: { main: "./shells/main.tsx" },
  middleware: {},
  routes: [
    { path: "/", file: "./routes/home.tsx", shell: "main", render: "ssr" },
  ],
});

const registry = {
  routeModules: {
    "./routes/home.tsx": async () => ({
      Component: ({ data }) => \`<h1>\${data.title}</h1>\`,
      loader: async () => ({ title: "Home" }),
      head: ({ data }) => ({ title: data.title }),
    }),
  },
  shellModules: {
    "./shells/main.tsx": async () => ({
      Shell: ({ children }) => \`<div>\${children}</div>\`,
    }),
  },
  middlewareModules: {},
};

describe("request pipeline", () => {
  it("renders the home page with loader data", async () => {
    const request = new Request("http://localhost/");
    const response = await handleViactRequest(request, {
      app,
      registry,
      mode: "development",
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Home");
  });

  it("returns loader data as JSON for client navigation", async () => {
    const request = new Request("http://localhost/", {
      headers: { "x-viact-route-state-request": "1" },
    });
    const response = await handleViactRequest(request, {
      app,
      registry,
      mode: "development",
    });

    const json = await response.json();
    expect(json.data.title).toBe("Home");
  });
});`}
      />

      <div class="doc-sep" />

      <h2>E2E Testing with Playwright</h2>
      <p>
        E2E tests run your full app in a real browser. This is the best way to
        verify hydration, client navigation, and form submissions.
      </p>

      <h3>Configuration</h3>
      <CodeBlock
        filename="playwright.config.ts"
        code={`import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  webServer: {
    command: "pnpm dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});`}
      />

      <h3>Testing SSR output</h3>
      <CodeBlock
        filename="e2e/ssr.test.ts"
        code={`import { test, expect } from "@playwright/test";

test("home page renders with server data", async ({ page }) => {
  await page.goto("/");

  // Check server-rendered content
  await expect(page.locator("h1")).toHaveText("Welcome");

  // Verify the page title from head()
  await expect(page).toHaveTitle(/Welcome/);
});

test("returns correct status for missing pages", async ({ request }) => {
  const response = await request.get("/nonexistent");
  expect(response.status()).toBe(404);
});`}
      />

      <h3>Testing client-side navigation</h3>
      <CodeBlock
        filename="e2e/navigation.test.ts"
        code={`import { test, expect } from "@playwright/test";

test("navigates between pages without full reload", async ({ page }) => {
  await page.goto("/");

  // Wait for hydration
  await page.waitForFunction(() => (window as any).__VIACT_ROUTER_READY__);

  // Click a link
  await page.click('a[href="/about"]');

  // URL updated
  await expect(page).toHaveURL("/about");

  // Content updated without full page reload
  await expect(page.locator("h1")).toHaveText("About");
});

test("shell persists across same-shell navigations", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__VIACT_ROUTER_READY__);

  // Mark the shell DOM to verify it's not re-mounted
  await page.evaluate(() => {
    document.querySelector(".shell")?.setAttribute("data-test", "mounted");
  });

  await page.click('a[href="/about"]');
  await expect(page).toHaveURL("/about");

  // Shell element should still have our marker
  const marker = await page.getAttribute(".shell", "data-test");
  expect(marker).toBe("mounted");
});`}
      />

      <h3>Testing form submissions</h3>
      <CodeBlock
        filename="e2e/forms.test.ts"
        code={`import { test, expect } from "@playwright/test";

test("submits contact form and shows success", async ({ page }) => {
  await page.goto("/contact");
  await page.waitForFunction(() => (window as any).__VIACT_ROUTER_READY__);

  await page.fill('input[name="name"]', "Alice");
  await page.fill('input[name="email"]', "alice@example.com");
  await page.fill('textarea[name="message"]', "Hello!");
  await page.click('button[type="submit"]');

  await expect(page.locator(".success")).toBeVisible();
});

test("shows validation errors on empty submit", async ({ page }) => {
  await page.goto("/contact");
  await page.waitForFunction(() => (window as any).__VIACT_ROUTER_READY__);

  await page.click('button[type="submit"]');

  await expect(page.locator(".field-error")).toHaveCount(3);
});`}
      />

      <h3>Testing API routes</h3>
      <CodeBlock
        filename="e2e/api.test.ts"
        code={`import { test, expect } from "@playwright/test";

test("GET /api/health returns ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("POST /api/echo returns the body", async ({ request }) => {
  const response = await request.post("/api/echo", {
    data: { message: "hello" },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.message).toBe("hello");
});

test("unsupported methods return 405", async ({ request }) => {
  const response = await request.delete("/api/health");
  expect(response.status()).toBe(405);
});`}
      />

      <div class="doc-sep" />

      <h2>Testing Route Data (JSON Endpoint)</h2>
      <p>
        During client navigation, viact fetches loader data as JSON. You can
        test this directly:
      </p>
      <CodeBlock
        code={`test("loader returns JSON for client navigation requests", async ({ request }) => {
  const response = await request.get("/dashboard", {
    headers: { "x-viact-route-state-request": "1" },
  });

  expect(response.status()).toBe(200);
  const json = await response.json();
  expect(json.data.projects).toBeDefined();
});`}
      />

      <div class="doc-sep" />

      <h2>Vitest Configuration</h2>
      <p>
        A minimal <code>vitest.config.ts</code> for a viact app:
      </p>
      <CodeBlock
        filename="vitest.config.ts"
        code={`import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exclude E2E tests (run those with Playwright)
    exclude: ["e2e/**", "node_modules/**"],
  },
});`}
      />

      <div class="doc-sep" />

      <h2>Test Scripts</h2>
      <p>
        Add these to your <code>package.json</code>:
      </p>
      <CodeBlock
        filename="package.json"
        code={`{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "check": "pnpm build && pnpm typecheck && pnpm test"
  }
}`}
      />

      <div class="doc-sep" />

      <h2>Tips</h2>
      <ul>
        <li>
          <strong>Test loaders directly</strong> — they're plain functions. No
          need to spin up a server for data logic tests.
        </li>
        <li>
          <strong>Use E2E for hydration</strong> — unit tests can't verify that
          client-side routing and hydration work correctly. That's what Playwright
          is for.
        </li>
        <li>
          Check for <code>{"(window as any).__VIACT_ROUTER_READY__"}</code> in
          Playwright tests to wait for hydration before interacting with the page.
        </li>
        <li>
          <strong>Test the JSON endpoint</strong> — send{" "}
          <code>x-viact-route-state-request: 1</code> to get loader data as
          JSON. Great for verifying data without parsing HTML.
        </li>
        <li>
          Keep E2E tests focused on behavior (navigation, form flows, error
          states) rather than visual assertions.
        </li>
      </ul>

      <div class="doc-nav">
        <a href="/docs/recipes/forms" class="doc-nav-card prev">
          <div class="doc-nav-dir">Previous</div>
          <div class="doc-nav-title">&larr; Forms</div>
        </a>
        <div />
      </div>
    </div>
  );
}
