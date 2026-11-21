import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { it } from 'node:test'
import { childExit } from './process.js'

it('reports compilation failure and missing executables', async () => {
	await assert.rejects(
		childExit(spawn(process.execPath, ['-e', 'process.exit(2)']), 'compiler'),
		/code 2/
	)
	await assert.rejects(childExit(spawn('swelte-nonexistent-test-executable'), 'compiler'), /ENOENT/)
})
