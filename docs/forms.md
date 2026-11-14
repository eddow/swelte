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

Opt in to `swelte: { compat: 'sveltekit' }` in `svelte.config.js` for
`?/delete` named actions, nested `{ data, form, params }` page props,
reactive `$app/state` and the `$app/forms` callback adapter. The default
keeps flat props and legacy qualifiers. `actionQuery: 'named' | 'legacy'`
overrides qualifier selection independently.

## No-JS (§12)

Browser navigations (`Accept: text/html`, no `application/json`) bypass
JSON: success → `303` + `Location` (cookies preserved), failure →
the page rendered with `form` data and the failure status. Fetch
stubs (`Accept: application/json`) keep JSON. Same handler,
content-negotiated. Automatic form success redirects apply to mutations;
load envelopes may independently redirect HTML GETs with 3xx + `Location`.
No-JS success redirects preserve ordinary query filters and remove the action
qualifier, for example `?/save&q=hello` redirects to `?q=hello`.

## `fail`-lite (§2.11)

No `fail(422, …)` helper. Convention: V throws `!T` with a
`{ ok: false, fieldErrors: {…} }` JSON body (status 422 by convention,
any 4xx works); client narrows with `sdk.ts isFail(e, status?)`:

```ts
try { await save_name({ name }) }
catch (e) { if (isFail(e)) showInline(e.body.fieldErrors) }
```

## `deserialize` (§2.12)

The native `deserialize(response)` helper parses the
action-result envelope
(`{"type":"success"|"failure"|"error"|"redirect",…}`) from a `fetch`
response. It takes a `Response`, rather than SvelteKit's serialized string.
Verbs return raw JSON — never the envelope — so
`__swelteActionResult` tries `deserialize` first, then maps raw bodies
by status (`2xx` → `success`, `4xx` → `failure`, `5xx` → `error`). `redirect` carries
`{ status, location }`; unknown `type` or non-JSON throws.

## `use:enhance` / `applyAction` (progressive-enhancement cycle)

No-JS still works untouched (browser submits natively, `Hand` answers
`303` / inline failure). With JS, `use:enhance` intercepts the submit and
replays it as `fetch` with `Accept: application/json`:

```svelte
<script>
  // Requires swelte.compat: 'sveltekit'.
  import { enhance } from '$app/forms';
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

Submission is prevented synchronously. A second submit or action destruction
aborts the previous request. The callback receives an AbortController and
submitter; method/action/enctype overrides are honored. Only success resets
the form. `update()` awaits the current page's load refresh, preserving mounted
component state; `update({ reset: false, invalidateAll: false })` opts out.
Results become obsolete when navigation starts. A superseded/aborted action
cannot publish form data after its refresh completes; refresh cannot replace
a pending navigation. Request cancellation does not roll back server effects.
Validation failures stay inline on `page.form`; redirects use the router.
An action targeting another page refreshes the current page without publishing
the unrelated form result there. `applyAction(result)` is available standalone.

The native `@swelte/core` enhance callback returns `(result, update) => ...`
and uses `invalidate: false`; the `$app/forms` adapter accepts
`({ result, update }) => ...` and `invalidateAll: false`. The adapter is a
supported subset, not complete SvelteKit parity. Action exceptions publish
their status/error and render the nearest route error component; validation failures
remain inline. Upload progress is not implemented.

