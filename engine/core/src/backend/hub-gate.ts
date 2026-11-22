// `@swelte/core/backend` — slim hub-only staging (no DB, no CLI, no attrs).
// §3 box 2 moved SQLite/KV + `swelte migrate` to `@swelte/plus/db`
// (explicit `plugins: [dbPlugin]` registration). What stays here is the
// room-hub transport gate for §3 box 3: when the Plus `db` plugin is
// present AND room-SSE/WS fns need the hub, core copies its own
// `vlib/backend/{hub,ws}.v` into `.swelte/backend/` (so the Plus `dbPlugin`
// stages `db.v` alone into the same dir — no duplicate-module collision).
// Core never imports plugin code: presence is a name check on `db`.
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SweltePlugin } from '../vite/types.js'

/** True when the Plus `db` plugin is in the resolved registration order. */
export function hasPlusDbPlugin(plugins: SweltePlugin[]): boolean {
	return plugins.some((p) => p?.name === 'db')
}

/** Absolute dir of the shipped core backend module (`vlib/backend/{hub,ws}.v`).
 * Core-internal: `src/backend/hub-gate.ts` → root, `dist/backend/hub-gate.js` → root.
 * The KV/SQLite `db.v` lives in `@swelte/plus` (§3 box 2). */
export function coreBackendVlibDir(): string {
	let dir = dirname(fileURLToPath(import.meta.url))
	for (let i = 0; i < 4; i++) {
		const cand = join(dir, 'vlib', 'backend')
		if (existsSync(join(cand, 'hub.v'))) return cand
		const parent = dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	// Fallback: sibling of this file's package (monorepo src layout).
	return join(dirname(fileURLToPath(import.meta.url)), '..', 'vlib', 'backend')
}

/** Basenames of the core-owned hub transport files staged into `.swelte/backend/`
 * (`hub.v` + `ws.v` only — never `db.v`, which Plus's `db` plugin owns). */
export function coreHubVlibFiles(): string[] {
	try {
		return readdirSync(coreBackendVlibDir())
			.filter((f) => f.endsWith('.v') && f !== 'db.v')
			.sort()
	} catch {
		return ['hub.v', 'ws.v']
	}
}
