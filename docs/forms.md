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
response. No client router needed: `use:enhance` calls this on the
fetch response. `redirect` carries `{ status, location }`; unknown
`type` or non-JSON throws.

