// Pure path helpers (no node:* imports — safe for browser `sdk.ts`
// and node `vite.ts`/`diagnostics.ts` alike).

/** Backend-only test (decided 2026-10-29): `backend/` dir segment at any
 * depth, or V-native `_backend.v` suffix (single-file exception without
 * moving the file). Backend runs purely on V — no `.ts`/`.js`/`.svelte`
 * under `backend/`. Accepts `a/b/c`, `a/b/c.v`, `backend/x.v`. */
export function isBackendMod(mod: string): boolean {
	const norm = mod.split('\\').join('/').replace(/\.v$/, '')
	const parts = norm.split('/').filter(Boolean)
	if (parts.includes('backend')) return true
	const stem = parts.pop() ?? ''
	return stem.endsWith('_backend')
}

/** Engine-owned `.swelte/` top-level dirs (never plugin modules, never
 * pruned as stale includes). Shared by generate()'s prune and the
 * build/dev `-enable-globals` detector. */
export const SWELTE_GEN_CORE_DIRS = ['routes', 'generated', 'types', 'app', 'dev']
