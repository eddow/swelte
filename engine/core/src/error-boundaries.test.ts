import assert from 'node:assert/strict'
import { it } from 'node:test'
import { selectErrorBoundaries } from './vite/error-boundaries.js'

it('selects physical ancestors for grouped pages and segment scopes for missing URLs', () => {
	const boundaries = ['', 'admin', 'admin/[id]', '(staff)/admin'].map((scope) => ({
		scope,
		svelte: `${scope ? `${scope}/` : ''}+error.svelte`,
		wrappers: [],
	}))
	const scopes = (mod: string | null, url: string) =>
		selectErrorBoundaries(boundaries, mod, url).map((boundary) => boundary.scope)
	assert.deepEqual(scopes('admin/[id]/+page.svelte', '/admin/42'), ['admin/[id]', 'admin', ''])
	assert.deepEqual(scopes('(staff)/admin/+page.svelte', '/admin'), ['(staff)/admin', ''])
	assert.deepEqual(scopes(null, '/admin/42/missing?q=x'), ['admin/[id]', 'admin', ''])
	assert.deepEqual(scopes(null, '/administrator'), [''])
})
