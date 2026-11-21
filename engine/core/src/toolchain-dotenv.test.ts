import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { loadDotenv } from './toolchain.js'

describe('toolchain: loadDotenv', () => {
	it('missing .env is a no-op', () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-dotenv-missing-'))
		try {
			assert.deepEqual(loadDotenv(root), {})
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it('parses KEY=value, quotes, comments, export prefix; env wins', () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-dotenv-'))
		const prev = process.env.SWELTE_DOTENV_PROBE
		process.env.SWELTE_DOTENV_PROBE = 'from-env'
		try {
			writeFileSync(
				join(root, '.env'),
				[
					'# comment',
					'',
					'OPENROUTER_API_KEY=sk-or-test',
					'QUOTED="hello world"',
					"SINGLE='a b'",
					'export EXPORTED=1',
					'SWELTE_DOTENV_PROBE=from-file',
					'not a kv line',
					'=nokey',
				].join('\n')
			)
			const loaded = loadDotenv(root)
			assert.equal(process.env.OPENROUTER_API_KEY, 'sk-or-test')
			assert.equal(process.env.QUOTED, 'hello world')
			assert.equal(process.env.SINGLE, 'a b')
			assert.equal(process.env.EXPORTED, '1')
			// Env wins over the file.
			assert.equal(process.env.SWELTE_DOTENV_PROBE, 'from-env')
			assert.equal(loaded.SWELTE_DOTENV_PROBE, 'from-file')
		} finally {
			delete process.env.OPENROUTER_API_KEY
			delete process.env.QUOTED
			delete process.env.SINGLE
			delete process.env.EXPORTED
			if (prev === undefined) delete process.env.SWELTE_DOTENV_PROBE
			else process.env.SWELTE_DOTENV_PROBE = prev
			rmSync(root, { recursive: true, force: true })
		}
	})
})
