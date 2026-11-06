<script lang="ts">
import {
	get_greeting,
	save_name,
	save_fail,
	greet_narrow,
	rename_greeting,
	touch_greeting,
} from '#routes/rpc/+page.v'
import type { GetGreetingResult, SaveNameResult, GreetNarrowResult } from '#routes/rpc/+page.v'
import { login, greet_pure, serve_pdf, make_created } from '#routes/api/greet.v'
import type { Session, SwelteResponse } from '#routes/api/greet.v'
import { SwelteRpcError, isFail, deserialize } from '@swelte/core'

let name = $state('world')
let greeting: GetGreetingResult = $state('')
let saved: SaveNameResult = $state('')
let saveFailNote = $state('')
let deserNote = $state('')
let session: Session | null = $state(null)
let pureSession: Session | null = $state(null)
let pdfInfo = $state('')
let createdInfo = $state('')
let renamed = $state('')
let touched = $state('')
let narrow: GreetNarrowResult = $state('')
let lastError = $state('')

function showError(e: unknown) {
	console.error(e)
	if (e instanceof SwelteRpcError) lastError = e.message
	else lastError = String(e)
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
	saveFailNote = ''
	try {
		saved = await save_name({ payload: name })
	} catch (e) {
		showError(e)
	}
}
async function saveFailLite() {
	lastError = ''
	saveFailNote = ''
	try {
		await save_fail({ payload: '' })
		saveFailNote = 'unexpected ok'
	} catch (e) {
		if (isFail(e, 422)) {
			const fe = (e.body as { fieldErrors?: Record<string, string> }).fieldErrors ?? {}
			saveFailNote = `fail-lite: ${Object.entries(fe)
				.map(([k, v]) => `${k}=${v}`)
				.join(', ')}`
		} else showError(e)
	}
}
async function deserEnvelope() {
	lastError = ''
	const res = new Response(JSON.stringify({ type: 'failure', status: 422, data: { ok: false } }), {
		status: 422,
		headers: { 'content-type': 'application/json' },
	})
	const out = await deserialize(res)
	deserNote = `deserialize: ${out.type}/${out.status}`
}
async function doLogin() {
	lastError = ''
	try {
		const res: SwelteResponse = await login({ payload: name })
		session = JSON.parse(
			typeof res.body === 'string' ? res.body : await (res.body as Blob).text()
		) as Session
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
		createdInfo = `created ${res.status}: ${typeof res.body === 'string' ? res.body : '(binary)'}`
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
async function putRename() {
	lastError = ''
	try {
		renamed = await rename_greeting({ payload: name })
	} catch (e) {
		showError(e)
	}
}
async function patchTouch() {
	lastError = ''
	try {
		touched = await touch_greeting({ payload: name })
	} catch (e) {
		showError(e)
	}
}
</script>

<main>
	<h1>rpc (verbs + @[rpc] + narrow + fail-lite)</h1>
	<nav><a href="/">home</a></nav>
	<input bind:value={name} placeholder="your name">
	<div style="display:flex; gap:0.5rem; margin-top:0.5rem; flex-wrap:wrap;">
		<button onclick={loadGreeting}>Greet (GET)</button>
		<button onclick={saveName}>Save (POST)</button>
		<button onclick={loadPure}>Pure (rpc typed)</button>
		<button onclick={doLogin}>Login (POST + cookie)</button>
		<button onclick={loadPdf}>PDF (binary)</button>
		<button onclick={loadCreated}>Created (201)</button>
		<button onclick={loadNarrow}>Narrow (narrow-args)</button>
		<button onclick={putRename}>Rename (@[put])</button>
		<button onclick={patchTouch}>Touch (@[patch])</button>
		<button onclick={saveFailLite}>Save fail-lite (422)</button>
		<button onclick={deserEnvelope}>Deserialize</button>
	</div>
	{#if greeting}
		<p>{greeting}</p>
	{/if}
	{#if saved}
		<p>{saved}</p>
	{/if}
	{#if saveFailNote}
		<p>{saveFailNote}</p>
	{/if}
	{#if deserNote}
		<p>{deserNote}</p>
	{/if}
	{#if session}
		<p>session {session.id} for {session.user}</p>
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
	{#if narrow}
		<p>{narrow}</p>
	{/if}
	{#if renamed}
		<p>{renamed}</p>
	{/if}
	{#if touched}
		<p>{touched}</p>
	{/if}
	{#if lastError}
		<pre style="color:crimson; white-space:pre-wrap;">{lastError}</pre>
	{/if}
	<hr>
	<h2>No-JS proof (plain forms, no fetch)</h2>
	<form method="post" action="/rpc">
		<input type="hidden" name="payload" value="nojs-alice">
		<button type="submit">Save via plain form (→ 303 → /rpc)</button>
	</form>
	<form method="post" action="/api/greet?upload" enctype="multipart/form-data">
		<input type="file" name="file">
		<button type="submit">Upload via plain form (→ 303)</button>
	</form>
</main>
