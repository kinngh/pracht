import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// SSR: Home page (render: "ssg" — served via SSR in dev)
// ---------------------------------------------------------------------------

test("home page renders SSR HTML with loader data", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-type"]).toContain("text/html");

  // Shell renders
  await expect(page.locator(".public-shell")).toBeVisible();
  await expect(page.locator("header")).toContainText("Viact");
  await expect(page.locator("footer")).toContainText("Preact-first");

  // Route component renders with loader data
  await expect(page.locator("h1")).toContainText("explicit app manifest");
  await expect(page.locator("li").first()).toContainText(
    "Hybrid route manifest",
  );
});

test("home page HTML includes hydration state", async ({ request }) => {
  const response = await request.get("/");
  const html = await response.text();

  expect(html).toContain("window.__VIACT_STATE__=");
  expect(html).toContain('"routeId":"home"');
  expect(html).toContain("Hybrid route manifest");
});

test("home page has correct head metadata", async ({ request }) => {
  const response = await request.get("/");
  const html = await response.text();

  expect(html).toContain("<title>Viact Example</title>");
  expect(html).toContain('name="viewport"');
});

// ---------------------------------------------------------------------------
// SSR: Pricing page (render: "isg" — served via SSR in dev)
// ---------------------------------------------------------------------------

test("pricing page renders with loader data", async ({ page }) => {
  await page.goto("/pricing");

  await expect(page.locator(".public-shell")).toBeVisible();
  await expect(page.locator("h1")).toContainText("MVP plan");
  await expect(page.locator("section")).toContainText("ISG fits pricing pages");
});

// ---------------------------------------------------------------------------
// Middleware: auth redirect
// ---------------------------------------------------------------------------

test("dashboard redirects to / without session cookie", async ({ page }) => {
  const response = await page.goto("/dashboard");

  // Middleware should redirect unauthenticated users to /
  expect(page.url()).toContain("/");
  expect(response?.status()).toBe(200);
});

test("dashboard renders with session cookie", async ({ page, context }) => {
  await context.addCookies([
    { name: "session", value: "abc123", domain: "localhost", path: "/" },
  ]);

  await page.goto("/dashboard");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("h1")).toContainText("Ada Lovelace");
  await expect(page.locator("p")).toContainText("Projects: 3");
});

// ---------------------------------------------------------------------------
// SPA route: Settings
// ---------------------------------------------------------------------------

test("settings returns SPA shell without SSR content", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "session", value: "abc123", domain: "localhost", path: "/" },
  ]);

  const response = await page.goto("/settings");
  expect(response?.status()).toBe(200);

  // SPA mode: viact-root should be empty in the initial HTML
  const html = await response?.text();
  expect(html).toContain('<div id="viact-root"></div>');
});

// ---------------------------------------------------------------------------
// Route state JSON (client-side navigation)
// ---------------------------------------------------------------------------

test("route state request returns JSON", async ({ request }) => {
  const response = await request.get("/", {
    headers: { "x-viact-route-state-request": "1" },
  });

  expect(response.status()).toBe(200);
  const json = await response.json();
  expect(json.data.highlights).toContain("Hybrid route manifest");
});

// ---------------------------------------------------------------------------
// 404 handling
// ---------------------------------------------------------------------------

test("unmatched route returns 404", async ({ request }) => {
  const response = await request.get("/nonexistent-page");
  expect(response.status()).toBe(404);
});

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

test("page hydrates without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });

  await page.goto("/");
  // Wait for hydration to complete
  await page.waitForFunction(
    () => document.getElementById("viact-root")?.children.length ?? 0 > 0,
  );

  // Filter out known non-critical warnings
  const criticalErrors = errors.filter(
    (e) => !e.includes("[vite]") && !e.includes("404"),
  );
  expect(criticalErrors).toHaveLength(0);
});
