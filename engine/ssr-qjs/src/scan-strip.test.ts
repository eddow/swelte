import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stripForScan, assertQjsCompatible, assertNoNodeExternals } from './ssr.js'

describe('item 16 — stripForScan (comments/strings/out-map)', () => {
	it('line comment hides fetch( but line numbers survive', () => {
		const src = 'const a = 1\n// fetch(\nconst b = 2\n'
		const { code, lineOf } = stripForScan(src)
		assert.ok(!code.includes('fetch('))
		assert.equal(code.length, src.length)
		// 1:1 map: index of `b` still resolves to line 3.
		assert.equal(lineOf(code.indexOf('b')), 3)
		// Comment body blanked but newline kept: same \n count.
		assert.equal(code.split('\n').length, src.split('\n').length)
	})

	it('"fetch(" inside a string literal is not flagged by the guard', () => {
		const src = 'const s = "fetch("\nfetch2()\n'
		const { code } = stripForScan(src)
		assert.ok(!code.includes('fetch('))
		assert.doesNotThrow(() => assertQjsCompatible('f.svelte', src))
	})

	it('template literal body is preserved length-wise with newlines kept', () => {
		const src = 'const t = `a\nfetch(\nb`\nconst x = 1\n'
		const { code, lineOf } = stripForScan(src)
		assert.equal(code.length, src.length)
		assert.ok(!code.includes('fetch('))
		// `x` sits on line 4 in both original and stripped code.
		assert.equal(lineOf(src.indexOf('const x')), 4)
		assert.equal(lineOf(code.indexOf('const x')), 4)
		// Comment `//` inside a string does not start comment-stripping:
		// the `//` is blanked as string body (not to end-of-line), so the
		// closing quote + newline survive and `y` stays on line 2.
		const tricky = 'const u = "a // b"\nconst y = 1\n'
		const stripped = stripForScan(tricky).code
		assert.equal(stripped.length, tricky.length)
		assert.equal(stripped.split('\n').length, 3)
		assert.ok(stripped.includes('const y'))
		assert.equal(stripForScan(tricky).lineOf(tricky.indexOf('const y')), 2)
		// With keepStrings the literal body survives the scan.
		assert.ok(stripForScan(tricky, true).code.includes('a // b'))
	})

	it('keepStrings keeps node: specifier text for the externals scan', () => {
		const src = `import x from 'node:fs'\n`
		assert.throws(() => assertNoNodeExternals('f.js', src))
		// Without keepStrings the literal would be blanked — the scanner
		// passes keepStrings=true exactly so the specifier survives.
		const { code } = stripForScan(src)
		assert.ok(!code.includes('node:fs'))
		const kept = stripForScan(src, true).code
		assert.ok(kept.includes('node:fs'))
		assert.equal(kept.split('\n').length, src.split('\n').length)
	})

	it('block comments spanning lines keep line numbers', () => {
		const src = 'const a = 1\n/* fetch(\nmore */\nfetch2()\n'
		const { code, lineOf } = stripForScan(src)
		assert.ok(!code.includes('fetch('))
		assert.equal(lineOf(code.indexOf('fetch2')), 4)
	})
})
