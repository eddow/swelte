<script lang="ts">
import { get_greeting, save_name } from '#routes/index.v'
import type { GetGreetingResult, SaveNameResult } from '#routes/index.v'
import { login } from '#routes/api/greet.v'
import type { LoginArgs, Session } from '#routes/api/greet.v'
import { hash_string } from '#lib/crypto/hash.v'
import type { HashArgs, HashStringResult } from '#lib/crypto/hash.v'
import { SwelteRpcError } from '@swelte/core'

let name = $state('world')
let greeting: GetGreetingResult = $state('')
let saved: SaveNameResult = $state('')
let session: Session | null = $state(null)
let hashed: HashStringResult = $state('')
let lastError = $state('')

function showError(e: unknown) {
	if (e instanceof SwelteRpcError) {
		lastError = e.message
	} else {
		lastError = String(e)
	}
}

async function loadGreeting() {
	lastError = ''
	try {
		greeting = await get_greeting({ payload: name })
	} catch (e) {
		showError(e)
	}
}
async function saveName() {
	lastError = ''
	try {
		saved = await save_name({ payload: name })
	} catch (e) {
		showError(e)
	}
}
async function hashName() {
	lastError = ''
	try {
		const args: HashArgs = { input: name }
		hashed = await hash_string(args)
	} catch (e) {
		showError(e)
	}
}
async function doLogin() {
	lastError = ''
	try {
		const args: LoginArgs = { payload: name }
		session = await login(args)
	} catch (e) {
		showError(e)
	}
}
</script>

<main>
	<h1>Swelte example: something</h1>
	<input bind:value={name} placeholder="your name">
	<div style="display:flex; gap:0.5rem; margin-top:0.5rem; flex-wrap:wrap;">
		<button onclick={loadGreeting}>Greet (#routes GET)</button>
		<button onclick={saveName}>Save (#routes POST)</button>
		<button onclick={hashName}>Hash (#lib WASM)</button>
		<button onclick={doLogin}>Login (#routes api struct)</button>
	</div>
	{#if greeting}
		<p>{greeting}</p>
	{/if}
	{#if saved}
		<p>{saved}</p>
	{/if}
	{#if hashed}
		<p>{hashed}</p>
	{/if}
	{#if session}
		<p>session {session.id} for {session.user} (remember={session.remember})</p>
	{/if}
	{#if lastError}
		<pre style="color:crimson; white-space:pre-wrap;">{lastError}</pre>
	{/if}
</main>
