import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
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

	it('bare @[sets_cookie] is rejected (removed — use SwelteResponse)', () => {
		assert.throws(
			() => parseVFile(`@[sets_cookie]\n@[rpc] pub fn login() string { return '' }`),
			/sets_cookie.*removed/
		)
	})

	it('verbs = HTTP, rpc = protocol-ignorant (parse keeps shapes; generate validates)', () => {
		const rpc = parseVFile(`@[rpc] pub fn f(args LoginArgs) !Session { return Session{} }`)
		assert.equal(rpc[0]?.attr, 'rpc')
		const verb = parseVFile(
			`@[get] pub fn g(req SwelteRequest) SwelteResponse { return SwelteResponse{} }`
		)
		assert.equal(verb[0]?.attr, 'get')
	})

	it('@[before]/@[after]/@[load] parse as attrs', () => {
		const fns = parseVFile(
			`@[before] pub fn b(req SwelteRequest) !SwelteRequest { return req }\n` +
				`@[after] pub fn a(req SwelteRequest, res SwelteResponse) !SwelteResponse { return res }\n` +
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
