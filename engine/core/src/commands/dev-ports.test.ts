import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { takePort, portFree, projectKillPattern, onSpawnError } from './dev.js'

describe('dev port helpers (no real binds except port 0)', () => {
	it('takePort fallbacks/NaN/negative', () => {
		assert.equal(takePort(1234, 80), 1234)
		assert.equal(takePort('abc', 80), 80)
		assert.equal(takePort(Number.NaN, 80), 80)
		assert.equal(takePort(-5, 80), 80)
		assert.equal(takePort(0, 80), 80)
		assert.equal(takePort('8080', 80), 8080)
	})

	it('portFree(0) true', async () => {
		assert.equal(await portFree(0), true)
	})

	it('projectKillPattern returns basename', () => {
		assert.equal(projectKillPattern('/a/b/my-app'), 'my-app')
	})

	it('onSpawnError logs readable hint', () => {
		const msgs: string[] = []
		const fake = { on: (ev: string, fn: (e: Error) => void) => {
			if (ev === 'error') fn(new Error('spawn ENOENT'))
		} }
		onSpawnError(fake as never, 'Vite', (m: string) => msgs.push(m))
		assert.ok(msgs.join(' ').includes('Vite'))
	})
})
