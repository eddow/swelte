import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseVFile } from './vite.js'

describe('attr fan-out + validation errors (parse level)', () => {
	it('stacked @[rpc; sse] fans out to two fns', () => {
		const fns = parseVFile(`@[rpc; sse] pub fn tick() string { return '' }`)
		assert.deepEqual(
			fns.map((f) => f.attr),
			['rpc', 'sse']
		)
	})

	it('two @[get] defaults: parse keeps both (generate rejects)', () => {
		const fns = parseVFile(
			`@[get] pub fn a() string { return '' }\n@[get] pub fn b() string { return '' }`
		)
		assert.equal(fns.length, 2)
	})

	it('duplicate qualifier parses with qualifier preserved', () => {
		const fns = parseVFile(`@[get('q')] pub fn a() string { return '' }`)
		assert.equal(fns[0]?.qualifier, 'q')
	})

	it('bare @[sets_cookie] carrier attaches to next verb', () => {
		const fns = parseVFile(`@[sets_cookie]\n@[rpc] pub fn login() string { return '' }`)
		assert.equal(fns[0]?.setsCookie, true)
	})

	it('@[before]/@[after]/@[load] parse as attrs', () => {
		const fns = parseVFile(
			`@[before] pub fn b(req SwelteRequest) !SwelteRequest { return req }\n` +
				`@[after] pub fn a(req SwelteRequest, body string) !string { return body }\n` +
				`@[load] pub fn l(req SwelteRequest) !string { return '' }`
		)
		assert.deepEqual(
			fns.map((f) => f.attr),
			['before', 'after', 'load']
		)
	})

	it('@[sse] alone parses (sse is a verb itself)', () => {
		const fns = parseVFile(`@[sse] pub fn tick() string { return '' }`)
		assert.equal(fns[0]?.attr, 'sse')
	})
})
