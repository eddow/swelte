<script lang="ts">
import { hash_string } from '#lib/crypto/hash.v'
import type { HashStringResult } from '#lib/crypto/hash.v'
import { SwelteRpcError } from '@swelte/core'

let name = $state('world')
let hashed: HashStringResult = $state('')
let note = $state('')

async function hashName() {
	note = ''
	try {
		hashed = await hash_string({ input: name })
	} catch (e) {
		note = e instanceof SwelteRpcError ? e.message : String(e)
	}
}
</script>

<main>
	<h1>wasm (#lib isomorphic)</h1>
	<nav><a href="/">home</a></nav>
	<p><input bind:value={name} placeholder="your name" /></p>
	<button onclick={hashName}>Hash (#lib WASM)</button>
	{#if hashed}<p>{hashed}</p>{/if}
	{#if note}<p>{note}</p>{/if}
	<p>Backend-only modules (<code>src/lib/backend/*</code>) are a build error from browser code — physical secret boundary.</p>
</main>
