// Isomorphic V library (`#lib/*` → WASM/dev-fallback + native).
//
// Put shared, backend-independent logic here: `src/lib/crypto/hash.v`
// (`@[rpc]`, same V compiles native + WASM). Backend-only code goes in
// `src/lib/backend/*.v` (or `*_backend.v`) — the physical boundary: it is
// a build error from browser/`#lib/` WASM imports.
//
// Svelte components and TypeScript helpers live here too. Export the public
// API from index.ts. `swelte package` builds this directory into package/;
// src/routes stays local application/demo code. See `docs/libraries.md`.
