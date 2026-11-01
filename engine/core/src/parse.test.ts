import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseStructs, parseVFile } from './vite.js'

describe('parseVFile', () => {
	it('verb + qualifier + fallible', () => {
		const fns = parseVFile(`@[get('q')] pub fn greet(name string) !string { return name }`)
		assert.equal(fns.length, 1)
		assert.equal(fns[0]?.attr, 'get')
		assert.equal(fns[0]?.qualifier, 'q')
		assert.equal(fns[0]?.fallible, true)
		assert.deepEqual(fns[0]?.params[0], {
			name: 'name',
			vtype: 'string',
			tstype: 'string',
			optional: false,
		})
		assert.equal(fns[0]?.vret, 'string')
	})
	it('stacked attrs fan out', () => {
		const fns = parseVFile(`@[rpc; sse] pub fn tick() string { return '' }`)
		assert.deepEqual(
			fns.map((f) => f.attr),
			['rpc', 'sse']
		)
	})
	it('unattributed fn ignored', () => {
		assert.equal(parseVFile(`pub fn helper(x int) int { return x }`).length, 0)
	})
	it('single-args struct expands (real greet.v shape)', () => {
		const src = `pub struct LoginArgs {\npub:\n\tpayload string\n}\n@[rpc]\n@[sets_cookie]\npub fn login(args LoginArgs) !Session {\n\treturn Session{}\n}`
		const fns = parseVFile(src)
		assert.equal(fns.length, 1)
		assert.equal(fns[0]?.singleArgsStruct, 'LoginArgs')
		assert.deepEqual(
			fns[0]?.params.map((p) => p.name),
			['payload']
		)
		assert.equal(fns[0]?.setsCookie, true)
		assert.equal(fns[0]?.fallible, true)
	})
})

describe('parseStructs', () => {
	it('fields under pub: (real Session shape)', () => {
		const sts = parseStructs(`pub struct Session {\npub:\n\tid string\n\tuser string\n\tremember bool\n}`)
		assert.equal(sts.length, 1)
		assert.deepEqual(
			sts[0]?.fields.map((f) => [f.name, f.tstype]),
			[
				['id', 'string'],
				['user', 'string'],
				['remember', 'boolean'],
			]
		)
	})
	it('unknown V type projects unknown', () => {
		// json.Any is the documented unknown projection (tsTypeFor).
		const sts = parseStructs(`pub struct W {\npub:\n\tpayload json.Any\n}`)
		assert.equal(sts[0]?.fields.length, 1)
		assert.equal(sts[0]?.fields[0]?.tstype, 'unknown')
	})
})
