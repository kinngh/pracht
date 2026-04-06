import { CodeBlock } from "../../components/CodeBlock";

export function head() {
  return { title: "Data Loading — viact docs" };
}

export function Component() {
  return (
    <div class="doc-page">
      <div class="breadcrumb">
        <a href="/">viact</a>
        <span class="breadcrumb-sep">/</span>
        <a href="/docs/routing">Docs</a>
        <span class="breadcrumb-sep">/</span>
        <span>Data Loading</span>
      </div>

      <h1 class="doc-title">Data Loading</h1>
      <p class="doc-lead">
        viact provides a unified data model that works across all rendering
        modes. Loaders fetch data on the server, actions handle mutations, and
        client hooks give reactive access to route data — all with full
        TypeScript inference.
      </p>

      <h2>Loaders</h2>
      <p>
        A <strong>loader</strong> is an async function exported from a route
        module. It runs server-side and returns serializable data that flows
        into the route component.
      </p>
      <CodeBlock
        filename="src/routes/dashboard.tsx"
        code={`import type { LoaderArgs, RouteComponentProps } from "viact";

export async function loader({ request, params, context }: LoaderArgs) {
  const user = await getUser(request);
  const projects = await context.db.projects.findMany({ userId: user.id });
  return { user, projects };
}

export function Component({ data }: RouteComponentProps<typeof loader>) {
  // data is typed: { user: User; projects: Project[] }
  return (
    <div>
      <h1>Welcome, {data.user.name}</h1>
      <ul>
        {data.projects.map(p => <li key={p.id}>{p.name}</li>)}
      </ul>
    </div>
  );
}`}
      />

      <h3>LoaderArgs</h3>
      <div class="doc-table-wrap">
        <table class="doc-table">
          <thead>
            <tr><th>Field</th><th>Type</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr><td>request</td><td>Request</td><td>The incoming Web Request</td></tr>
            <tr><td>params</td><td>RouteParams</td><td>Dynamic URL params, e.g. <code>{`{ slug: "hello" }`}</code></td></tr>
            <tr><td>context</td><td>TContext</td><td>App-level context from the adapter's context factory</td></tr>
            <tr><td>signal</td><td>AbortSignal</td><td>Cancellation signal for timeouts</td></tr>
            <tr><td>url</td><td>URL</td><td>Parsed URL object</td></tr>
            <tr><td>route</td><td>ResolvedRoute</td><td>Matched route metadata</td></tr>
          </tbody>
        </table>
      </div>

      <h3>When loaders run</h3>
      <div class="doc-table-wrap">
        <table class="doc-table">
          <thead>
            <tr><th>Scenario</th><th>Loader runs on</th></tr>
          </thead>
          <tbody>
            <tr><td>SSG build</td><td>Build machine, once per path</td></tr>
            <tr><td>SSR request</td><td>Server, every request</td></tr>
            <tr><td>ISG initial</td><td>Build machine, then server on revalidation</td></tr>
            <tr><td>SPA</td><td>Server, during client navigation fetch</td></tr>
            <tr><td>Client navigation</td><td>Server (fetched as JSON)</td></tr>
          </tbody>
        </table>
      </div>

      <div class="callout callout-note">
        <span class="callout-icon">🔒</span>
        <span>
          Loaders <strong>never</strong> run in the browser. Database
          connections, API keys, and secrets in loader code stay server-side
          permanently.
        </span>
      </div>

      <h3>Error handling</h3>
      <CodeBlock code={`import { ViactHttpError } from "viact";

export async function loader({ params }: LoaderArgs) {
  const post = await getPost(params.slug);
  if (!post) throw new ViactHttpError(404, "Post not found");
  return { post };
}

// Optional: render an error boundary for this route
export function ErrorBoundary({ error }: ErrorBoundaryProps) {
  return <p>Error: {error.message}</p>;
}`} />

      <div class="doc-sep" />

      <h2>Actions</h2>
      <p>
        Actions handle form submissions and mutations. They receive POST, PUT,
        PATCH, or DELETE requests to the current route's URL.
      </p>
      <CodeBlock code={`export async function action({ request, context }: ActionArgs) {
  const form = await request.formData();
  const name = String(form.get("name") || "").trim();

  if (!name) return { ok: false, data: { error: "Name is required" } };

  await context.db.projects.create({ name });
  return { ok: true, revalidate: ["route:self"] };
}`} />

      <h3>Return values</h3>
      <div class="doc-table-wrap">
        <table class="doc-table">
          <thead>
            <tr><th>Return</th><th>Effect</th></tr>
          </thead>
          <tbody>
            <tr><td>Plain data</td><td>Serialized to the client as JSON</td></tr>
            <tr><td><code>{`{ ok, data, revalidate }`}</code></td><td>Structured result with revalidation hints</td></tr>
            <tr><td><code>{`{ redirect: "/path" }`}</code></td><td>Server-side redirect after the action</td></tr>
            <tr><td><code>{`{ data, headers }`}</code></td><td>Custom response headers (cookies, cache-control)</td></tr>
          </tbody>
        </table>
      </div>

      <h3>Revalidation hints</h3>
      <CodeBlock code={`return {
  ok: true,
  revalidate: ["route:self"],          // Re-run this route's loader
  // revalidate: ["route:dashboard"],  // Re-run a specific route by ID
};`} />

      <div class="doc-sep" />

      <h2>Head Metadata</h2>
      <p>
        The <code>head</code> export controls <code>&lt;head&gt;</code> content
        for the route. It receives the loader data as its argument:
      </p>
      <CodeBlock code={`export function head({ data }: HeadArgs<typeof loader>) {
  return {
    title: \`\${data.post.title} — My Blog\`,
    meta: [
      { name: "description", content: data.post.excerpt },
      { property: "og:title", content: data.post.title },
      { property: "og:image", content: data.post.coverUrl },
    ],
    link: [
      { rel: "canonical", href: \`https://example.com/blog/\${data.post.slug}\` },
    ],
  };
}`} />

      <div class="doc-sep" />

      <h2>Client Hooks</h2>

      <h3>useRouteData()</h3>
      <p>
        Access the current route's loader data reactively. Updates
        automatically on navigation and revalidation.
      </p>
      <CodeBlock code={`export function Component() {
  const data = useRouteData<typeof loader>();
  return <span>{data.user.name}</span>;
}`} />

      <h3>useRevalidateRoute()</h3>
      <p>Imperatively re-run the current route's loader:</p>
      <CodeBlock code={`export function Component() {
  const revalidate = useRevalidateRoute();
  return <button onClick={() => revalidate()}>Refresh</button>;
}`} />

      <h3>useSubmitAction()</h3>
      <p>Submit an action programmatically (without a form element):</p>
      <CodeBlock code={`const submit = useSubmitAction();
await submit({ method: "POST", body: formData });`} />

      <h3>&lt;Form&gt; Component</h3>
      <p>
        Declarative form submission that calls the route's action with
        progressive enhancement:
      </p>
      <CodeBlock code={`import { Form } from "viact";

export function Component() {
  return (
    <Form method="post">
      <input name="title" placeholder="Project name" />
      <button type="submit">Create</button>
    </Form>
  );
}`} />
      <p>
        The <code>&lt;Form&gt;</code> component intercepts submit and sends via{" "}
        <code>fetch</code> (no full page reload), automatically revalidates
        based on action response hints, and falls back to native submission if
        JavaScript fails.
      </p>

      <div class="doc-sep" />

      <h2>API Routes</h2>
      <p>
        Standalone server endpoints for REST APIs, webhooks, and health checks.
        Files in <code>src/api/</code> are auto-discovered and mapped to URLs:
      </p>
      <CodeBlock
        filename="src/api/users/[id].ts"
        code={`// src/api/health.ts  → GET /api/health
// src/api/users/[id].ts → GET /api/users/:id

export async function GET({ params, context }: ApiRouteArgs) {
  const user = await context.db.users.find(params.id);
  if (!user) return new Response("Not found", { status: 404 });
  return Response.json(user);
}

export async function DELETE({ params, context }: ApiRouteArgs) {
  await context.db.users.delete(params.id);
  return new Response(null, { status: 204 });
}`}
      />
      <p>
        API routes export named HTTP method handlers, return{" "}
        <code>Response</code> objects directly, share the same context system
        as page routes, and are excluded from client bundles entirely.
      </p>

      <div class="doc-nav">
        <a href="/docs/rendering" class="doc-nav-card">
          <div class="doc-nav-dir">← Previous</div>
          <div class="doc-nav-title">Rendering Modes</div>
        </a>
        <a href="/docs/adapters" class="doc-nav-card next">
          <div class="doc-nav-dir">Next</div>
          <div class="doc-nav-title">Adapters →</div>
        </a>
      </div>
    </div>
  );
}
