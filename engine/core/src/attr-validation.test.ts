import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collectUnknownAttrs, parseVFile } from './vite.js'

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

	it('unknown attrs: unclaimed cron + typo warn, known/plugin/native stay silent', () => {
		// `@[cron]` with no plugin registered → unknown (would silently drop).
		assert.deepEqual(
			collectUnknownAttrs(`@[cron('60s')] pub fn tick() { }`).map((u) => u.name),
			['cron']
		)
		// Registered via extraAttrs (jobs plugin on) → known, silent.
		assert.deepEqual(collectUnknownAttrs(`@[cron('60s')] pub fn tick() { }`, ['cron']), [])
		// Typo'd core attr warns with the fn's line.
		assert.deepEqual(collectUnknownAttrs(`module p\n@[gett]\npub fn a() string { return '' }`), [
			{ name: 'gett', line: 2 },
		])
		// Core attrs + stacked mixes stay silent.
		assert.deepEqual(collectUnknownAttrs(`@[rpc]\n@[sse]\npub fn tick() string { return '' }`), [])
		// V-native attrs (`@[heap]`, `@[unsafe]`, `@[required]`, `@[json: ...]`)
		// are never dispatch — silent, and never consume the fn.
		assert.deepEqual(collectUnknownAttrs(`@[heap]\npub fn tick() string { return '' }`), [])
		assert.deepEqual(
			collectUnknownAttrs(`@[required]\n@[get]\npub fn g() string { return '' }`),
			[]
		)
		assert.deepEqual(collectUnknownAttrs(`@[json: 'name']\npub fn tick() string { return '' }`), [])
		// `// @[sse]` comment lines never warn (parse-level merge guard).
		assert.deepEqual(
			collectUnknownAttrs(`// @[bogus]\n@[get]\npub fn g() string { return '' }`),
			[]
		)
		// parseVFile still drops unknowns (the warn replaces silent loss).
		assert.deepEqual(
			parseVFile(`@[cron('60s')] pub fn tick() { }`).map((f) => f.attr),
			[]
		)
	})
})
