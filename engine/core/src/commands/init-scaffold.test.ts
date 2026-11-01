import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit } from './init.js'

function ctxFor(dir: string, opts: Record<string, unknown>, rest: string[] = []) {
	const logs: string[] = []
	return {
		ctx: {
			argv: [],
			opts: opts as never,
			rest,
			log: (m: string) => logs.push(m),
			error: (m: string) => logs.push(m),
		},
		logs,
		parent: dir,
	}
}

describe('swelte init scaffolds (no prompt in tests)', () => {
	it('empty scaffold: no api routes dir', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		const { ctx } = ctxFor(parent, { empty: true, root: parent }, ['empty-app'])
		await runInit(ctx as never)
		assert.ok(existsSync(join(parent, 'empty-app', 'package.json')))
		assert.ok(existsSync(join(parent, 'empty-app', 'src', 'routes', '+page.v')))
		assert.ok(!existsSync(join(parent, 'empty-app', 'src', 'routes', 'api')))
	})

	it('sample scaffold: greet route present + __NAME__ replaced', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		const { ctx } = ctxFor(parent, { sample: true, root: parent }, ['sample-app'])
		await runInit(ctx as never)
		assert.ok(existsSync(join(parent, 'sample-app', 'src', 'routes', 'api', 'greet.v')))
		const pkg = readFileSync(join(parent, 'sample-app', 'package.json'), 'utf8')
		assert.ok(pkg.includes('sample-app'))
		assert.ok(!pkg.includes('__NAME__'))
	})

	it('non-empty target throws', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		mkdirSync(join(parent, 'taken'), { recursive: true })
		writeFileSync(join(parent, 'taken', 'x.txt'), 'hi')
		const { ctx } = ctxFor(parent, { empty: true, root: parent }, ['taken'])
		await assert.rejects(() => runInit(ctx as never), /not empty/)
	})

	it('template: empty alias bypasses prompt', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'swelte-init-'))
		const { ctx } = ctxFor(parent, { template: 'empty', root: parent }, ['alias-app'])
		await runInit(ctx as never)
		assert.ok(existsSync(join(parent, 'alias-app', 'package.json')))
	})
})
