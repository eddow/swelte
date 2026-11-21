import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { maybeStartSsrSidecar, onSpawnError, portFree, requireFreePort, takePort } from './dev.js'

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

	it('rejects an occupied port without stopping its owner', async () => {
		const holder = createServer()
		await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve))
		try {
			const address = holder.address()
			assert.ok(address && typeof address === 'object')
			await assert.rejects(requireFreePort(address.port), /already in use/)
			assert.equal(holder.listening, true)
		} finally {
			await new Promise<void>((resolve) => holder.close(() => resolve()))
		}
	})

	it('onSpawnError logs readable hint', () => {
		const msgs: string[] = []
		const fake = {
			on: (ev: string, fn: (e: Error) => void) => {
				if (ev === 'error') fn(new Error('spawn ENOENT'))
			},
		}
		onSpawnError(fake as never, 'Vite', (m: string) => msgs.push(m))
		assert.ok(msgs.join(' ').includes('Vite'))
	})

	it('maybeStartSsrSidecar: --no-ssr skips without probing', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-no-ssr-'))
		writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x' }))
		assert.equal(await maybeStartSsrSidecar(root, { ssr: false }, () => {}), null)
	})

	it('maybeStartSsrSidecar: explicit SWELTE_SSR_URL wins (external renderer)', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-env-ssr-'))
		writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x' }))
		const prev = process.env.SWELTE_SSR_URL
		process.env.SWELTE_SSR_URL = 'http://127.0.0.1:9999'
		try {
			assert.equal(await maybeStartSsrSidecar(root, {}, () => {}), null)
		} finally {
			if (prev === undefined) delete process.env.SWELTE_SSR_URL
			else process.env.SWELTE_SSR_URL = prev
		}
	})

	it('maybeStartSsrSidecar: no adapter installed -> null (SPA unchanged)', async () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-spa-'))
		writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x' }))
		const prev = process.env.SWELTE_SSR_URL
		delete process.env.SWELTE_SSR_URL
		try {
			assert.equal(await maybeStartSsrSidecar(root, {}, () => {}), null)
		} finally {
			if (prev !== undefined) process.env.SWELTE_SSR_URL = prev
		}
	})
})
