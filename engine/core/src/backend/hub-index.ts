// `@swelte/core` hub-transport gate (§3 box 3 pending).
// SQLite/KV + `migrate` moved to `@swelte/plus/db` (§3 box 2); `vite/*`
// and `commands/*` import the hub helpers from here, this module never
// imports `vite/*` (no cycle). `hub-gate.ts` imports `vite/types.js` only
// (name check — core never imports plugin code).
export { coreBackendVlibDir, coreHubVlibFiles, hasPlusDbPlugin } from './hub-gate.js'
