<script lang="ts">
import { type_row, calc_probe, blob_bytes, hook_raw } from '#routes/types/+page.v'
import { SwelteRpcError } from '@swelte/core'

let rowInfo = $state('')
let calcInfo = $state('')
let blobInfo = $state('')
let hookInfo = $state('')

function showError(e: unknown) {
	const msg = e instanceof SwelteRpcError ? e.message : String(e)
	rowInfo = calcInfo = blobInfo = hookInfo = ''
	hookInfo = msg
}

async function loadRow() {
	try {
		const row = await type_row({})
		rowInfo = `row ${row.name} count=${row.count} active=${row.active} tags=${row.tags.join(',')} stamp=${typeof row.stamp}`
	} catch (e) {
		showError(e)
	}
}
async function loadCalc() {
	try {
		calcInfo = await calc_probe({ count: '3', ratio: '1.5', active: 'true' })
	} catch (e) {
		showError(e)
	}
}
async function loadBlob() {
	try {
		const blob = await blob_bytes({})
		blobInfo = `blob ${(blob as Blob).size}B ${(blob as Blob).type}`
	} catch (e) {
		showError(e)
	}
}
async function loadHook() {
	try {
		hookInfo = await hook_raw({})
	} catch (e) {
		showError(e)
	}
}
</script>

<main>
	<h1>types (TypeRow + narrow + bytes)</h1>
	<nav><a href="/">home</a></nav>
	<div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
		<button onclick={loadRow}>Typerow (?row)</button>
		<button onclick={loadCalc}>Calc (?calc)</button>
		<button onclick={loadBlob}>Blob ([]u8)</button>
		<button onclick={loadHook}>Raw (?hook)</button>
	</div>
	{#if rowInfo}
		<p>{rowInfo}</p>
	{/if}
	{#if calcInfo}
		<p>{calcInfo}</p>
	{/if}
	{#if blobInfo}
		<p>{blobInfo}</p>
	{/if}
	{#if hookInfo}
		<p>{hookInfo}</p>
	{/if}
</main>
