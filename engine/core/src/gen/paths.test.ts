import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isBackendMod } from './paths.js'

describe('isBackendMod', () => {
	it('backend segment at any depth', () => {
		assert.equal(isBackendMod('backend/x'), true)
		assert.equal(isBackendMod('a/backend/b'), true)
		assert.equal(isBackendMod('a/b'), false)
	})
	it('_backend suffix', () => {
		assert.equal(isBackendMod('secrets_backend'), true)
		assert.equal(isBackendMod('secrets_backend.v'), true)
		assert.equal(isBackendMod('backendish/x'), false)
	})
})
