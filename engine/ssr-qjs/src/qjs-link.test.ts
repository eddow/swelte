import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { bridgeSrc, buildQjsProd, whichCC } from './qjs.js'

describe('item 25 — QJS prod link (gcc-gated)', () => {
	const cc = whichCC()
	const gate = cc ? it : (it.skip ?? it)

	gate('libqjs.a built once (mtime guard skips rebuild), bridge + flags shape', async (_t) => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-qjs-'))
		const out1 = buildQjsProd({ root, renderJs: join(root, 'dist', 'ssr', 'render.js') })
		assert.ok(existsSync(out1.lib))
		assert.ok(existsSync(out1.bridge))
		assert.ok(out1.bridge.endsWith(join('.swelte', 'routes', 'swelte_qjs_bridge.v')))
		assert.ok(out1.flags.includes('-lqjs -lm'))
		assert.ok(out1.qjscNote.length > 0)
		const mt1 = statSync(out1.lib).mtimeMs
		// Second build with no source change: archive untouched.
		await new Promise((r) => setTimeout(r, 20))
		const out2 = buildQjsProd({ root, renderJs: join(root, 'dist', 'ssr', 'render.js') })
		assert.equal(out2.lib, out1.lib)
		assert.equal(statSync(out2.lib).mtimeMs, mt1)
	})

	it('bridgeSrc interpolates timeout/mem constants, no template holes', () => {
		// Pure-shape half: runs even without a compiler.
		const src = bridgeSrc('/lib/libqjs.a', '/c/dir', 50, 16)
		assert.ok(src.includes('return 50'))
		assert.ok(src.includes('u32(16)'))
		assert.ok(src.includes('swelte_qjs.h'))
		assert.ok(!src.includes('${timeoutMs}') && !src.includes('${memoryMB}'))
	})
})
