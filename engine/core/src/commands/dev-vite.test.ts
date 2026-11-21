import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { portFree } from './dev.js'
import { startDevVite } from './dev-vite.js'

it('starts, restarts and closes Vite without taking over host signals or env', {
	timeout: 15000,
}, async () => {
	const root = mkdtempSync(join(tmpdir(), 'swelte-vite-api-'))
	writeFileSync(join(root, 'index.html'), '<html><body>owned Vite server</body></html>')
	writeFileSync(join(root, 'vite.config.mjs'), 'export default { server: { host: "127.0.0.1" } }')
	const probe = createServer()
	await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
	const address = probe.address()
	assert.ok(address && typeof address === 'object')
	const port = address.port
	await new Promise<void>((resolve) => probe.close(() => resolve()))
	const signalsBefore = process.listeners('SIGTERM')
	const envBefore = process.env.SWELTE_VITE_WORKER_TEST
	const controllerBefore = process.env.SWELTE_DEV_CONTROLLER
	let vite: Awaited<ReturnType<typeof startDevVite>> | undefined
	try {
		vite = await startDevVite(root, port, { ...process.env, SWELTE_VITE_WORKER_TEST: 'worker' })
		assert.match(await (await fetch(`http://127.0.0.1:${port}`)).text(), /owned Vite server/)
		await vite.restart()
		assert.match(await (await fetch(`http://127.0.0.1:${port}`)).text(), /owned Vite server/)
		await vite.close()
		await vite.close()
		assert.equal(await portFree(port), true)
		assert.deepEqual(process.listeners('SIGTERM'), signalsBefore)
		assert.equal(process.env.SWELTE_VITE_WORKER_TEST, envBefore)
		// The single-writer flag stays inside the Vite worker's env —
		// it must not leak into the CLI process.
		assert.equal(process.env.SWELTE_DEV_CONTROLLER, controllerBefore)
	} finally {
		await vite?.close()
		rmSync(root, { recursive: true, force: true })
	}
})
