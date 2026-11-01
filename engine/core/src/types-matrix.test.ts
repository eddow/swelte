import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseStructs, parseVFile, tsTypeFor } from './vite.js'

describe('tsTypeFor projection matrix (docs/types.md)', () => {
	const cases: Array<[string, string]> = [
		['int', 'number'],
		['i64', 'number'],
		['u32', 'number'],
		['f64', 'number'],
		['bool', 'boolean'],
		['string', 'string'],
		['time.Time', 'number'],
		['[]u8', 'string'],
		['[]string', 'string[]'],
		['[]int', 'number[]'],
		['map[string]string', 'unknown'],
		['?string', 'string | null'],
		['?int', 'number | null'],
		['?json.Any', 'unknown'],
		['json.Any', 'unknown'],
		['json2.Any', 'unknown'],
		['!string', 'string'],
		['Session', 'Session'],
		// Double-`?` nests today (`string | null | null`); V never emits it.
		['??string', 'string | null | null'],
		['void', 'void'],
		['Time', 'Time'],
	]
	for (const [vtype, want] of cases) {
		it(`${vtype} -> ${want}`, () => {
			assert.equal(tsTypeFor(vtype), want)
		})
	}

	it('unknown V type projects unknown', () => {
		assert.equal(tsTypeFor('chan int'), 'unknown')
	})

	it('single ? unwrap then ! fallible strip', () => {
		// `?!T` is not a real V shape; fallible is tracked separately.
		const fns = parseVFile(`@[rpc] pub fn f() !string { return '' }`)
		assert.equal(fns[0]?.vret, 'string')
		assert.equal(fns[0]?.tsret, 'string')
		assert.equal(fns[0]?.fallible, true)
	})

	it('optional param marks optional', () => {
		const fns = parseVFile(`@[get] pub fn f(name ?string) string { return '' }`)
		assert.equal(fns[0]?.params[0]?.optional, true)
		assert.equal(fns[0]?.params[0]?.tstype, 'string | null')
	})

	it('struct field types project through parseStructs', () => {
		const sts = parseStructs(
			`pub struct M {\npub:\n\ta int\n\tb bool\n\tc time.Time\n\td []u8\n\te []string\n\tf map[string]int\n\tg ?string\n\th json.Any\n\ti Session\n}`
		)
		assert.deepEqual(
			sts[0]?.fields.map((f) => [f.name, f.tstype]),
			[
				['a', 'number'],
				['b', 'boolean'],
				['c', 'number'],
				['d', 'string'],
				['e', 'string[]'],
				// `map[string]int` keeps `unknown` today (prefix check is
				// backslash-escaped, see tsTypeFor) — documented warn path.
				['f', 'unknown'],
				['g', 'string | null'],
				['h', 'unknown'],
				['i', 'Session'],
			]
		)
	})
})
