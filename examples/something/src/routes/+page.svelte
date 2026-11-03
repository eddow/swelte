<script lang="ts">
import { tick } from 'svelte'
import { get_greeting, save_name, save_fail, greet_narrow } from '#routes/+page.v'
import type {
	GetGreetingResult,
	SaveNameResult,
	SaveFailResult,
	GreetNarrowResult,
	SwelteRequest,
} from '#routes/+page.v'
import { login, greet_pure, serve_pdf, make_created, tick_stream, rename_greeting, touch_greeting } from '#routes/api/greet.v'
import { tick_items } from '#routes/api/ticks.v'
import { blob_bytes, hook_raw } from '#routes/api/blob.v'
import { type_row, calc_probe } from '#routes/api/types.v'
import type { Session, SwelteResponse } from '#routes/api/greet.v'
import { hash_string } from '#lib/crypto/hash.v'
import type { HashStringResult } from '#lib/crypto/hash.v'
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
let hashed: HashStringResult = $state('')
let narrow: GreetNarrowResult = $state('')
let lastError = $state('')
let ticks: string[] = $state([])
let listed: string[] = $state([])
let renamed = $state('')
let touched = $state('')
let blobInfo = $state('')
let hookInfo = $state('')
let rowInfo = $state('')
let calcInfo = $state('')

function showError(e: unknown) {
	console.error(e)
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
	saveFailNote = ''
	try {
		saved = await save_name({ payload: name })
	} catch (e) {
		showError(e)
	}
}

// Item 4: fail-lite — empty `?save` POST 422s with
// `{ ok: false, fieldErrors }`; narrowed inline via `isFail(e, 422)`.
async function saveFailLite() {
	lastError = ''
	saveFailNote = ''
	try {
		await save_fail({ payload: '' })
		saveFailNote = 'unexpected ok (item 4)'
	} catch (e) {
		if (isFail(e, 422)) {
			const fe = (e.body as { fieldErrors?: Record<string, string> }).fieldErrors ?? {}
			saveFailNote = `inline fail-lite (item 4): ${Object.entries(fe).map(([k, v]) => `${k}=${v}`).join(', ')}`
		} else {
			showError(e)
		}
	}
}

// Item 4 (second assert, independent): `deserialize` on a SvelteKit
// failure envelope. Raw verb JSON has no envelope (use
// `__swelteActionResult` there) — this asserts the envelope shape.
async function deserEnvelope() {
	lastError = ''
	const res = new Response(JSON.stringify({ type: 'failure', status: 422, data: { ok: false } }), {
		status: 422,
		headers: { 'content-type': 'application/json' },
	})
	const out = await deserialize(res)
	deserNote = `deserialize envelope (item 4): ${out.type}/${out.status}`
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
		session = JSON.parse(typeof res.body === 'string' ? res.body : await (res.body as Blob).text()) as Session } // SwelteResponse envelope: body is raw text for JSON (Blob only on binary CT)
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
async function streamTicks() {
	lastError = ''
	ticks = []
	try {
		// SSE emit mode (item 5): `?live` qualifier, paced frames.
		for await (const t of tick_stream({ n: '3', wait_ms: '500' })) {
			ticks = [...ticks, t]
			await tick()
		}
	} catch (e) {
		showError(e)
	}
}
async function streamList() {
	lastError = ''
	listed = []
	try {
		// SSE list mode (item 5): separate file, identical `for await` shape.
		for await (const t of tick_items({})) {
			listed = [...listed, t]
			await tick()
		}
	} catch (e) {
		showError(e)
	}
}
async function putRename() {
	lastError = ''
	try {
		// Item 6: `@[put]` verb — JSON round-trip, 405 arm stays quiet.
		renamed = await rename_greeting({ payload: name })
	} catch (e) {
		showError(e)
	}
}
async function patchTouch() {
	lastError = ''
	try {
		// Item 6: `@[patch]` verb — JSON round-trip.
		touched = await touch_greeting({ payload: name })
	} catch (e) {
		showError(e)
	}
}
async function loadBlob() {
	lastError = ''
	try {
		const blob = await blob_bytes({})
		blobInfo = `blob ${(blob as Blob).size}B ${(blob as Blob).type}`
	} catch (e) {
		showError(e)
	}
}
async function loadHook() {
	lastError = ''
	try {
		hookInfo = await hook_raw({})
	} catch (e) {
		showError(e)
	}
}
async function loadRow() {
	lastError = ''
	try {
		const row = await type_row({})
		rowInfo = `row ${row.name} count=${row.count} active=${row.active} tags=${row.tags.join(',')} stamp=${typeof row.stamp}`
	} catch (e) {
		showError(e)
	}
}
async function loadCalc() {
	lastError = ''
	try {
		calcInfo = await calc_probe({ count: '3', ratio: '1.5', active: 'true' })
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
		<button onclick={streamList}>List (SSE []string)</button>
		<button onclick={putRename}>Rename (@[put])</button>
		<button onclick={patchTouch}>Touch (@[patch])</button>
		<button onclick={loadNarrow}>Narrow (#routes GET narrow-args)</button>
		<button onclick={loadBlob}>Blob ([]u8)</button>
		<button onclick={loadHook}>Raw (?hook)</button>
		<button onclick={loadRow}>Typerow (?row)</button>
		<button onclick={loadCalc}>Calc (?calc)</button>
		<button onclick={saveFailLite}>Save fail-lite (item 4)</button>
		<button onclick={deserEnvelope}>Deserialize (item 4)</button>
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
	{#if listed.length}
		<p>list: {listed.join(' | ')}</p>
	{/if}
	{#if renamed}
		<p>{renamed}</p>
	{/if}
	{#if touched}
		<p>{touched}</p>
	{/if}
	{#if narrow}
		<p>{narrow}</p>
	{/if}
	{#if blobInfo}
		<p>{blobInfo}</p>
	{/if}
	{#if hookInfo}
		<p>{hookInfo}</p>
	{/if}
	{#if rowInfo}
		<p>{rowInfo}</p>
	{/if}
	{#if calcInfo}
		<p>{calcInfo}</p>
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
