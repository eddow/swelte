import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { posixNormalize, withDot } from './ssr.js'
import { defaultSsrDevPort, renderFileFor } from './dev.js'
import { bridgeSrc } from './qjs.js'

describe('item 19 — path keys (posixNormalize/withDot)', () => {
	it('../+error.svelte from ./admin/+page.svelte → ./+error.svelte', () => {
		assert.equal(
			withDot(posixNormalize('./admin/+page.svelte', '../+error.svelte')),
			'./+error.svelte'
		)
	})

	it('already-./ untouched; route table maps verbatim', () => {
		assert.equal(withDot('./+error.svelte'), './+error.svelte')
		assert.equal(withDot('/abs/path'), '/abs/path')
		assert.equal(posixNormalize('./a/b.svelte', './c.svelte'), 'a/c.svelte')
		// Route table keys pass through withDot on the svelte path
		// (compose entry uses the same helper — spot-check here).
		assert.equal(withDot('admin/+page.svelte'), './admin/+page.svelte')
	})
})

describe('item 20 — renderFileFor selection', () => {
	function scaffold(): string {
		const root = mkdtempSync(join(tmpdir(), 'swelte-renderfile-'))
		mkdirSync(join(root, '.swelte', 'dev'), { recursive: true })
		writeFileSync(join(root, '.swelte', 'dev', 'render.js'), '// dev')
		return root
	}

	it('dev bundle preferred when preferProd=false', () => {
		const root = scaffold()
		assert.equal(renderFileFor(root, '.swelte', false), join(root, '.swelte', 'dev', 'render.js'))
	})

	it('prod dist/ssr/render.js when preferProd=true and it exists', () => {
		const root = scaffold()
		mkdirSync(join(root, 'dist', 'ssr'), { recursive: true })
		writeFileSync(join(root, 'dist', 'ssr', 'render.js'), '// prod')
		assert.equal(renderFileFor(root, '.swelte', true), join(root, 'dist', 'ssr', 'render.js'))
		// preferProd=false ignores prod (pins dev for HMR).
		assert.equal(renderFileFor(root, '.swelte', false), join(root, '.swelte', 'dev', 'render.js'))
	})

	it('missing both → dev path (caller handles ENOENT)', () => {
		const root = mkdtempSync(join(tmpdir(), 'swelte-norender-'))
		const p = renderFileFor(root, '.swelte', false)
		assert.equal(p, join(root, '.swelte', 'dev', 'render.js'))
		assert.ok(!existsSync(p))
	})

	it('defaultSsrDevPort is 8132', () => {
		assert.equal(defaultSsrDevPort(), 8132)
	})
})

describe('item 22 — bridgeSrc shape', () => {
	it('contains render entrypoint + timeout/mem constants + single-artifact note', () => {
		const src = bridgeSrc('/lib/libqjs.a', '/c/dir', 50, 16)
		assert.ok(src.includes('swelte_qjs_render_page'))
		assert.ok(src.includes('return 50'))
		assert.ok(src.includes('u32(16)'))
		assert.ok(src.includes('swelte_qjs.h'))
		assert.ok(src.includes('#flag -lm -lpthread -ldl'))
		assert.ok(src.includes('libqjs.a'))
		// Timeout/mem are interpolated, not left as template holes.
		assert.ok(!src.includes('${timeoutMs}') && !src.includes('${memoryMB}'))
	})
})
