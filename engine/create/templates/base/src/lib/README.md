// Isomorphic V library (`#lib/*` → WASM/dev-fallback + native).
//
// Put shared, backend-independent logic here: `src/lib/crypto/hash.v`
// (`@[rpc]`, same V compiles native + WASM). Backend-only code goes in
// `src/lib/backend/*.v` (or `*_backend.v`) — the physical boundary: it is
// a build error from browser/`#lib/` WASM imports.
//
// This file keeps the (otherwise empty) directory in git — delete it once
// you add your first real module. See `docs/rpc.md`.
