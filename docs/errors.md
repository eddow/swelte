# Errors + SPA-first dev proxy

## Envelope

Every 4xx from the V backend is JSON:

```json
{ "error": "unknown fn", "fn": "nope_missing", "path": "/api/greet", "available": ["login"] }
{ "error": "missing \"fn\"", "fn": "", "path": "/" }
{ "error": "bad json body, want {\"fn\",\"args\"}", "fn": "", "path": "/" }
{ "error": "missing payload", "fn": "login", "path": "/api/greet" }
{ "error": "unknown qualifier", "fn": "", "path": "/", "available": ["delete"] }
```

- unknown `@[rpc]` fn → 404 + available `@[rpc]` fns on that path
- missing `"fn"` in JSON body → 400 (form/verb routes never need it)
- bad JSON → 400; `!T` failure → 400 with `err.msg()`
- unknown `?q` qualifier → 404 + available qualifiers for that verb
- method without handler (e.g. DELETE on a file with no `@[delete]`) → 405
- unknown path → 404 `{"error":"not found"}`
- body over `SWELTE_BODY_LIMIT` (default 10MB) → 413 `{"error":"body too large"}` (before routing, multipart included)
- over `SWELTE_RATE_LIMIT` reqs / `SWELTE_RATE_WINDOW_MS` per IP → 429 `{"error":"rate limited"}` (fixed-window, in-memory, single-instance; IP from V-injected `Remote-Addr`, never `X-Forwarded-For`)
- handler over `SWELTE_HANDLER_TIMEOUT_MS` (default 10s) → 500 `{"error":"handler timeout"}` (server stays up; the timed-out thread still runs to completion in the background, so a burst of slow handlers still costs a thread each)

Env knobs share one rule: unset, invalid, `0`, or negative → built-in
default. (No disable switch: `0` means default, not off.)

### No-JS forms (§12)

Browser navigations (`Accept: text/html`, no `application/json`) bypass JSON: success → `303` + `Location` (cookies preserved), failure → rendered HTML error page (same status, message HTML-escaped). Fetch stubs (`Accept: application/json`) keep today's JSON. Same handler, content-negotiated.

## Client

`sdk.ts` exports only `SwelteRpcError` (`status`, `body`, `base`,
`fn`) + the internal `__swelteFetch` / `__swelteWasmCall` runtimes:
`swelte: "nope_missing" on / failed (HTTP 404): unknown fn —
available: save_name`. `#lib/` misses use the same shape with
status 0 (WASM never touches HTTP) — e.g. `WASM compile failed`,
`unknown fn` + available exports, `bad string return`, wasm traps.

## SPA-first proxy rule (vite.ts)

`GET /` (no `?q=`, no `Accept: application/json`) always serves Vite
(page), regardless of `Accept`. Only proxied to V:
`Accept: application/json` GETs, JSON bodies, form bodies
(multipart/urlencoded). Result: browser refresh never hits the API;
curl does.
