import { CodeBlock } from "../../components/CodeBlock";

export function head() {
  return { title: "Forms — Recipes — viact docs" };
}

export function Component() {
  return (
    <div class="doc-page">
      <div class="breadcrumb">
        <a href="/">viact</a>
        <span class="breadcrumb-sep">/</span>
        <a href="/docs/getting-started">Docs</a>
        <span class="breadcrumb-sep">/</span>
        <span>Forms</span>
      </div>

      <h1 class="doc-title">Forms &amp; Validation</h1>
      <p class="doc-lead">
        Handle form submissions with progressive enhancement using viact's{" "}
        <code>{"<Form>"}</code> component and route actions. Forms work without
        JavaScript and upgrade to fetch-based submissions when JS is available.
      </p>

      <h2>Basic Form</h2>
      <p>
        The simplest pattern: a <code>{"<Form>"}</code> that posts to the
        current route's action, with server-side validation.
      </p>
      <CodeBlock
        filename="src/routes/contact.tsx"
        code={`import type { ActionArgs, RouteComponentProps } from "viact";
import { Form } from "viact";

export async function action({ request }: ActionArgs) {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();

  const errors: Record<string, string> = {};
  if (!name) errors.name = "Name is required";
  if (!email || !email.includes("@")) errors.email = "Valid email is required";
  if (!message) errors.message = "Message is required";

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: { errors, values: { name, email, message } } };
  }

  await sendContactEmail({ name, email, message });
  return { ok: true, data: { sent: true } };
}

export function Component({ actionData }: RouteComponentProps) {
  if (actionData?.sent) {
    return <p class="success">Thanks! We'll be in touch.</p>;
  }

  const errors = actionData?.errors ?? {};
  const values = actionData?.values ?? {};

  return (
    <div>
      <h1>Contact Us</h1>
      <Form method="post">
        <label>
          Name
          <input type="text" name="name" value={values.name} />
          {errors.name && <span class="field-error">{errors.name}</span>}
        </label>

        <label>
          Email
          <input type="email" name="email" value={values.email} />
          {errors.email && <span class="field-error">{errors.email}</span>}
        </label>

        <label>
          Message
          <textarea name="message">{values.message}</textarea>
          {errors.message && <span class="field-error">{errors.message}</span>}
        </label>

        <button type="submit">Send</button>
      </Form>
    </div>
  );
}`}
      />

      <div class="doc-sep" />

      <h2>How It Works</h2>
      <ol>
        <li>
          <code>{"<Form method=\"post\">"}</code> intercepts the submit event and
          sends data via <code>fetch</code> (no full reload).
        </li>
        <li>
          The route's <code>action()</code> runs server-side, validates, and
          returns data.
        </li>
        <li>
          The component re-renders with <code>actionData</code> containing the
          action's return value.
        </li>
        <li>
          If JavaScript is disabled, the form still works — it falls back to a
          native form POST.
        </li>
      </ol>

      <div class="doc-sep" />

      <h2>Posting to a Different Route</h2>
      <p>
        Use the <code>action</code> prop to submit to a different route's
        action:
      </p>
      <CodeBlock
        code={`<Form method="post" action="/api/newsletter">
  <input type="email" name="email" placeholder="you@example.com" />
  <button type="submit">Subscribe</button>
</Form>`}
      />

      <div class="doc-sep" />

      <h2>Programmatic Submission</h2>
      <p>
        Use <code>useSubmitAction()</code> when you need to submit from code
        rather than a form element:
      </p>
      <CodeBlock
        code={`import { useSubmitAction } from "viact";

export function Component() {
  const submit = useSubmitAction();

  async function handleDelete(id: string) {
    if (!confirm("Are you sure?")) return;

    const formData = new FormData();
    formData.set("id", id);
    formData.set("intent", "delete");

    await submit({ method: "POST", body: formData });
  }

  return <button onClick={() => handleDelete("123")}>Delete</button>;
}`}
      />

      <div class="doc-sep" />

      <h2>Multiple Actions with Intent</h2>
      <p>
        Use a hidden <code>intent</code> field to handle multiple actions in
        one route:
      </p>
      <CodeBlock
        filename="src/routes/settings.tsx"
        code={`export async function action({ request }: ActionArgs) {
  const form = await request.formData();
  const intent = form.get("intent");

  switch (intent) {
    case "update-profile": {
      const name = String(form.get("name"));
      await db.users.update({ name });
      return { ok: true, revalidate: ["route:self"] };
    }
    case "change-password": {
      const current = String(form.get("current"));
      const next = String(form.get("next"));
      // validate and update...
      return { ok: true, data: { passwordChanged: true } };
    }
    case "delete-account": {
      await db.users.delete();
      return { redirect: "/" };
    }
    default:
      return { ok: false, data: { error: "Unknown action" } };
  }
}`}
      />
      <p>In the component, use separate forms for each action:</p>
      <CodeBlock
        code={`<Form method="post">
  <input type="hidden" name="intent" value="update-profile" />
  <input name="name" value={data.user.name} />
  <button type="submit">Save Profile</button>
</Form>

<Form method="post">
  <input type="hidden" name="intent" value="change-password" />
  <input type="password" name="current" placeholder="Current password" />
  <input type="password" name="next" placeholder="New password" />
  <button type="submit">Change Password</button>
</Form>`}
      />

      <div class="doc-sep" />

      <h2>File Uploads</h2>
      <CodeBlock
        code={`<Form method="post" enctype="multipart/form-data">
  <input type="file" name="avatar" accept="image/*" />
  <button type="submit">Upload</button>
</Form>`}
      />
      <CodeBlock
        code={`export async function action({ request }: ActionArgs) {
  const form = await request.formData();
  const file = form.get("avatar") as File;

  if (!file || file.size === 0) {
    return { ok: false, data: { error: "No file selected" } };
  }

  const buffer = await file.arrayBuffer();
  const url = await uploadToStorage(file.name, buffer);
  return { ok: true, data: { url } };
}`}
      />

      <div class="doc-sep" />

      <h2>Revalidation After Mutations</h2>
      <p>
        When an action modifies data, return <code>revalidate</code> hints so
        the page shows fresh content without a full reload:
      </p>
      <CodeBlock
        code={`export async function action({ request }: ActionArgs) {
  const form = await request.formData();
  await db.todos.create({ text: String(form.get("text")) });

  return {
    ok: true,
    revalidate: ["route:self"],  // Re-runs this route's loader
  };
}`}
      />
      <p>
        The <code>{"<Form>"}</code> component handles this automatically — after
        the action responds, it re-fetches the loader data and updates the UI.
      </p>

      <div class="doc-sep" />

      <h2>Tips</h2>
      <ul>
        <li>
          Always validate on the server. Client-side validation is a UX nicety,
          not a security boundary.
        </li>
        <li>
          Return field values in error responses so users don't lose their input.
        </li>
        <li>
          Use <code>revalidate: ["route:self"]</code> after mutations that change
          the current page's data.
        </li>
        <li>
          Actions have automatic CSRF protection — the framework validates the{" "}
          <code>Origin</code> header on non-GET requests.
        </li>
      </ul>

      <div class="doc-nav">
        <a href="/docs/recipes/auth" class="doc-nav-card prev">
          <div class="doc-nav-dir">Previous</div>
          <div class="doc-nav-title">&larr; Authentication</div>
        </a>
        <a href="/docs/recipes/testing" class="doc-nav-card next">
          <div class="doc-nav-dir">Next</div>
          <div class="doc-nav-title">Testing &rarr;</div>
        </a>
      </div>
    </div>
  );
}
