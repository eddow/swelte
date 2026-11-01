<script lang="ts">
import { tick } from 'svelte'
import { get_greeting, save_name, greet_narrow } from '#routes/+page.v'
import type {
	GetGreetingResult,
	SaveNameResult,
	GreetNarrowResult,
	SwelteRequest,
} from '#routes/+page.v'
import { login, greet_pure, serve_pdf, make_created, tick_stream } from '#routes/api/greet.v'
import type { Session, SwelteResponse } from '#routes/api/greet.v'
import { hash_string } from '#lib/crypto/hash.v'
import type { HashStringResult } from '#lib/crypto/hash.v'
import { SwelteRpcError } from '@swelte/core'

let name = $state('world')
let greeting: GetGreetingResult = $state('')
let saved: SaveNameResult = $state('')
let session: Session | null = $state(null)
let pureSession: Session | null = $state(null)
let pdfInfo = $state('')
let createdInfo = $state('')
let hashed: HashStringResult = $state('')
let narrow: GreetNarrowResult = $state('')
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
		{ const res: SwelteResponse = await login({ payload: name })
		session = JSON.parse(typeof res.body === 'string' ? res.body : await (res.body as Blob).text()) as Session }
	} catch (e) {
		showError(e)
	}
}
async function loadPure() {
	lastError = ''
	try {
		pureSession = await greet_pure({ payload: name })
	} catch (e) {
		showError(e)
	}
}
async function loadPdf() {
	lastError = ''
	try {
		const res = await serve_pdf({})
		const blob = res.body as Blob
		pdfInfo = `pdf ${blob.size}B ${blob.type}`
	} catch (e) {
		showError(e)
	}
}
async function loadCreated() {
	lastError = ''
	try {
		const res = await make_created({})
		createdInfo = `created ${res.status}: ${res.body}`
	} catch (e) {
		showError(e)
	}
}
async function loadNarrow() {
	lastError = ''
	try {
		narrow = await greet_narrow({ name, age: 42, nick: 'al' })
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
	<h1>Swelte example: something</h1>
	<input bind:value={name} placeholder="your name">
	<div style="display:flex; gap:0.5rem; margin-top:0.5rem; flex-wrap:wrap;">
		<button onclick={loadGreeting}>Greet (#routes GET)</button>
		<button onclick={saveName}>Save (#routes POST)</button>
		<button onclick={hashName}>Hash (#lib WASM)</button>
		<button onclick={doLogin}>Login (POST verb + cookie)</button>
		<button onclick={loadPure}>Pure (rpc typed)</button>
		<button onclick={loadPdf}>PDF (verb binary)</button>
		<button onclick={loadCreated}>Created (verb 201)</button>
		<button onclick={streamTicks}>Stream (#routes SSE)</button>
		<button onclick={loadNarrow}>Narrow (#routes GET narrow-args)</button>
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
	{#if pureSession}
		<p>pure {pureSession.id} for {pureSession.user}</p>
	{/if}
	{#if pdfInfo}
		<p>{pdfInfo}</p>
	{/if}
	{#if createdInfo}
		<p>{createdInfo}</p>
	{/if}
	{#if ticks.length}
		<p>stream: {ticks.join(' | ')}</p>
	{/if}
	{#if narrow}
		<p>{narrow}</p>
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
