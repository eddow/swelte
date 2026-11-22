// Core stages no backend V modules (sections 3.2-3.3 done): Plus owns `db`
// (`db.v`), `jobs` (cron) and `rooms` (`hub.v` + `ws.v`). Core keeps the
// HTTP verbs, plain SSE (list/emit) and WS *transport* (harness upgrade +
// socket pump) plus the `import backend` raw-import path (app-owned `db.v`
// scaffold, backend.emit from plain routes).
// Run via `npm test --workspace=@swelte/core` (tsconfig.test.json -> dist-test).

import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

function coreBackendVlibDir(): string {
	let dir = dirname(fileURLToPath(import.meta.url))
	for (let i = 0; i < 5; i++) {
		const cand = join(dir, 'vlib', 'backend')
		if (existsSync(join(cand, '..', '..', 'package.json'))) return cand
		const parent = dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'vlib', 'backend')
}

describe('no core backend modules (Plus owns db + rooms)', () => {
	it('core ships no backend V modules', () => {
		const dir = coreBackendVlibDir()
		if (!existsSync(dir)) return // no backend dir at all - ideal
		const files = readdirSync(dir).filter((f) => f.endsWith('.v'))
		assert.deepEqual(files, [], `core vlib/backend must be empty (got ${files})`)
	})
})
