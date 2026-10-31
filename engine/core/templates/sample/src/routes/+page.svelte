<script lang="ts">
import { tick } from 'svelte'
import { get_greeting, save_name } from '#routes/+page.v'
import type { GetGreetingResult, SaveNameResult, SwelteRequest } from '#routes/+page.v'
import { login, tick_stream } from '#routes/api/greet.v'
import type { Session } from '#routes/api/greet.v'
import { hash_string } from '#lib/crypto/hash.v'
import type { HashStringResult } from '#lib/crypto/hash.v'
import { SwelteRpcError } from '@swelte/core'

let name = $state('world')
let greeting: GetGreetingResult = $state('')
let saved: SaveNameResult = $state('')
let session: Session | null = $state(null)
let hashed: HashStringResult = $state('')
let lastError = $state('')
let ticks: string[] = $state([])

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
		hashed = await hash_string({ input: name })
	} catch (e) {
		showError(e)
	}
}
async function doLogin() {
	lastError = ''
	try {
		session = await login({ payload: name })
	} catch (e) {
		showError(e)
	}
}
async function streamTicks() {
	lastError = ''
	ticks = []
	try {
		for await (const t of tick_stream({ n: '3', wait_ms: '500' })) {
			ticks = [...ticks, t]
			await tick()
		}
	} catch (e) {
		showError(e)
	}
}
</script>

<main>
	<h1>Swelte example: __NAME__</h1>
	<input bind:value={name} placeholder="your name">
	<div style="display:flex; gap:0.5rem; margin-top:0.5rem; flex-wrap:wrap;">
		<button onclick={loadGreeting}>Greet (#routes GET)</button>
		<button onclick={saveName}>Save (#routes POST)</button>
		<button onclick={hashName}>Hash (#lib WASM)</button>
		<button onclick={doLogin}>Login (#routes api struct)</button>
		<button onclick={streamTicks}>Stream (#routes SSE)</button>
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
	{#if ticks.length}
		<p>stream: {ticks.join(' | ')}</p>
	{/if}
	{#if lastError}
		<pre style="color:crimson; white-space:pre-wrap;">{lastError}</pre>
	{/if}
	<hr>
	<h2>No-JS proof (plain forms, no fetch)</h2>
	<form method="post" action="/">
		<input type="hidden" name="payload" value="nojs-alice">
		<button type="submit">Save via plain form (→ 303 → /)</button>
	</form>
	<form method="post" action="/api/greet?upload" enctype="multipart/form-data">
		<input type="file" name="file">
		<button type="submit">Upload via plain form (→ 303)</button>
	</form>
</main>
