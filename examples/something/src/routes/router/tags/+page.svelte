<script lang="ts">
import { onMount } from 'svelte'
// Item 1 proof: tag registry in the SDK — `depends(...tags)` inside a
// load registers tags; `invalidate(...tags)` clears matching load keys,
// `invalidateAll()` clears all (client-side). Pure-TS, no V side.
import { depends, invalidate, invalidateAll, __swelteTrackLoad } from '@swelte/core'
import { browser } from '#app/environment'

let userN = $state(0)
let otherN = $state(0)
let log: string[] = $state([])

// Simulated loads: each registers its tags under its own key via
// the track-load helper (same shape real load wrappers use).
// NOTE: the generated client router does not consult the tag registry
// (invalidate only drops keys) — so the demo re-runs the cleared keys
// manually, which is what a real load wrapper does after invalidate
// (no full goto).
function loadUser() {
	__swelteTrackLoad('tags:user', () => depends('user'))
	userN++
}
function loadOther() {
	__swelteTrackLoad('tags:other', () => depends('other'))
	otherN++
}

if (browser) {
	onMount(() => {
		loadUser()
		loadOther()
		log = [...log, 'initial: both loads ran']
	})
}

function doInvalidateUser() {
	const hit = invalidate('user')
	log = [...log, `invalidate('user') → cleared [${hit.join(', ') || '∅'}]`]
	// Re-run only the cleared loads (no full goto): selective refresh.
	if (hit.includes('tags:user')) loadUser()
	if (hit.includes('tags:other')) loadOther()
}

function doInvalidateAll() {
	invalidateAll()
	const after = invalidate('user')
	log = [...log, `invalidateAll() → cleared all (re-probe: [${after.join(', ') || '∅'}])`]
	loadUser()
	loadOther()
}
</script>

<main>
	<h1>router/tags (item 1: depends / invalidate / invalidateAll)</h1>
	<nav><a href="/">home</a> · <a href="/router">router</a></nav>
	<p>user load runs: {userN} · other load runs: {otherN}</p>
	<div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
		<button onclick={doInvalidateUser}>invalidate('user')</button>
		<button onclick={doInvalidateAll}>invalidateAll()</button>
	</div>
	{#if log.length}
		<ul>
			{#each log as l}
				<li>{l}</li>
			{/each}
		</ul>
	{/if}
</main>
