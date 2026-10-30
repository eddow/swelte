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
