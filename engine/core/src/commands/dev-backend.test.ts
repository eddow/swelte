import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { it } from 'node:test'
import { DevBackend } from './dev-backend.js'
import type { DevApplication } from './dev-control.js'

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((yes) => {
		resolve = yes
	})
	return { promise, resolve }
}
function fixture() {
	const events: string[] = []
	let failBuild = false
	let buildGate: ReturnType<typeof deferred> | undefined
	let stopGate: ReturnType<typeof deferred> | undefined
	const backend = new DevBackend({
		build: async (generation) => {
			events.push(`build:${generation}`)
			await buildGate?.promise
			if (failBuild) throw new Error('compile failed')
			return `binary:${generation}`
		},
		launch: async (_binary, generation): Promise<DevApplication> => {
			events.push(`launch:${generation}`)
			let stopped: Promise<void> | undefined
			return {
				child: {} as ChildProcess,
				ready: Promise.resolve(),
				exited: Promise.resolve({ code: 0, signal: null }),
				stop: () =>
					(stopped ??= (async () => {
						events.push(`stop:${generation}`)
						await stopGate?.promise
						events.push(`exit:${generation}`)
					})()),
			}
		},
		discard: async (binary) => {
			events.push(`discard:${binary}`)
		},
		log: (message) => {
			events.push(message)
		},
	})
	return {
		backend,
		events,
		fail: () => {
			failBuild = true
		},
		blockBuild: () => (buildGate = deferred()),
		blockStop: () => (stopGate = deferred()),
	}
}

it('compilation failure preserves the running application', async () => {
	const f = fixture()
	await f.backend.restart()
	f.fail()
	await f.backend.restart()
	assert.ok(f.events.includes('compile failed'))
	assert.equal(
		f.events.some((event) => event.startsWith('stop:')),
		false
	)
	await f.backend.stop()
})

it('coalesces edits during a build and discards stale candidates before stopping the old application', async () => {
	const f = fixture()
	await f.backend.restart()
	const gate = f.blockBuild()
	const replacement = f.backend.restart()
	void f.backend.restart()
	void f.backend.restart()
	gate.resolve()
	await replacement
	assert.equal(f.events.includes('launch:2'), false)
	assert.equal(f.events.includes('build:3'), false)
	assert.ok(f.events.includes('discard:binary:2'))
	assert.ok(f.events.indexOf('build:4') < f.events.indexOf('stop:1'))
	assert.ok(f.events.indexOf('exit:1') < f.events.indexOf('launch:4'))
	await f.backend.stop()
})

it('waits for confirmed old-process exit before launching the replacement', async () => {
	const f = fixture()
	await f.backend.restart()
	const gate = f.blockStop()
	const replacement = f.backend.restart()
	await new Promise((resolve) => setImmediate(resolve))
	assert.ok(f.events.includes('stop:1'))
	assert.equal(f.events.includes('launch:2'), false)
	gate.resolve()
	await replacement
	assert.ok(f.events.indexOf('exit:1') < f.events.indexOf('launch:2'))
	await f.backend.stop()
})

it('quit supersedes an in-progress build and prevents every queued replacement', async () => {
	const f = fixture()
	await f.backend.restart()
	const gate = f.blockBuild()
	void f.backend.restart()
	void f.backend.restart()
	const stopped = f.backend.stop()
	gate.resolve()
	await stopped
	await f.backend.restart()
	assert.equal(f.events.filter((event) => event.startsWith('launch:')).length, 1)
	assert.ok(f.events.includes('discard:binary:2'))
})

it('serializes Vite regeneration with native compilation and replacement', async () => {
	const f = fixture()
	await f.backend.restart()
	const gate = f.blockBuild()
	const replacement = f.backend.restart()
	const ui = f.backend.restartUi(async () => {
		f.events.push('ui:restart')
	})
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(f.events.includes('ui:restart'), false)
	gate.resolve()
	await Promise.all([replacement, ui])
	assert.ok(f.events.indexOf('launch:2') < f.events.indexOf('ui:restart'))
	await f.backend.stop()
})
