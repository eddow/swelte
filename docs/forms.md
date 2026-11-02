# Forms + fail + deserialize

## Verbs + `?q` replace `actions{}`

No `actions{save,delete}` namespace. One default fn per verb per file,
`?q` qualifiers for many-per-file:

```html
<form action="?delete" method="post">
```

```v
@[post('delete')]
pub fn delete_account(req SwelteRequest) !string { ... }
```

`<form action="?q">` → the file's `@[post('q')]` handler. Content-Type
decides: JSON → `@[rpc]`, form (multipart/urlencoded) → verb dispatch.

## No-JS (§12)

Browser navigations (`Accept: text/html`, no `application/json`) bypass
JSON: success → `303` + `Location` (cookies preserved), failure →
rendered HTML error page (same status, message HTML-escaped). Fetch
stubs (`Accept: application/json`) keep JSON. Same handler,
content-negotiated. `GET` navigations never redirect (`303` is
POST-only). No-JS form redirects target the POST path (`Location:
<path>` back to the form).

## `fail`-lite (§2.11)

No `fail(422, …)` helper. Convention: V throws `!T` with a
`{ ok: false, fieldErrors: {…} }` JSON body (status 422 by convention,
any 4xx works); client narrows with `sdk.ts isFail(e, status?)`:

```ts
try { await save_name({ name }) }
catch (e) { if (isFail(e)) showInline(e.body.fieldErrors) }
```

## `deserialize` (§2.12)

Pure TS port of SvelteKit's `deserialize` in `sdk.ts` — parses the
action-result envelope
(`{"type":"success"|"failure"|"error"|"redirect",…}`) from a `fetch`
response. Verbs return raw JSON — never the envelope — so
`__swelteActionResult` tries `deserialize` first, then maps raw bodies
by status (`2xx` → `success`, else `failure`). `redirect` carries
`{ status, location }`; unknown `type` or non-JSON throws.

## `use:enhance` / `applyAction` (progressive-enhancement cycle)

No-JS still works untouched (browser submits natively, `Hand` answers
`303` / error page). With JS, `use:enhance` intercepts the submit and
replays it as `fetch` with `Accept: application/json`:

```svelte
<script>
  import { enhance } from '@swelte/core';
</script>

<form method="post" use:enhance>
  …
</form>

<form method="post" use:enhance={({ formData, cancel }) => {
  if (!formData.get('name')) cancel();
  return async ({ result, update }) => {
    if (result.type === 'redirect') await update({ reset: false });
    else await update();
  };
}}>
```

Behavior: default `update()` is `applyAction` + form reset. `success`
publishes the payload on `page.form` and invalidates cached loads
(`update({ invalidate: false })` skips); `failure`/`error` publish on
`page.form` too (action failures stay inline — never `page.error`,
which remains load-time only); `redirect` navigates via the client
router (`goto`, `location.href` fallback outside the router).
`applyAction(result)` is also usable standalone. Out of scope:
file-upload progress, `invalidateAll` outside the default update,
multi-form ordering — same lite line as the rest of this page.

