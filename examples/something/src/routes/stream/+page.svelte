<script lang="ts">
import { SwelteRpcError } from '@swelte/core'
import { tick } from 'svelte'
import { tick_stream } from '#routes/api/greet.v'
import { tick_items } from '#routes/api/ticks.v'

let ticks: string[] = $state([])
let listed: string[] = $state([])
let note = $state('')

async function streamTicks() {
	note = ''
	ticks = []
	try {
		for await (const t of tick_stream({ n: '3', wait_ms: '500' })) {
			ticks = [...ticks, t]
			await tick()
		}
	} catch (e) {
		note = e instanceof SwelteRpcError ? e.message : String(e)
	}
}

async function streamList() {
	note = ''
	listed = []
	try {
		for await (const t of tick_items({})) {
			listed = [...listed, t]
			await tick()
		}
	} catch (e) {
		note = e instanceof SwelteRpcError ? e.message : String(e)
	}
}
</script>

<main>
	<h1>stream (SSE emit + list)</h1>
	<nav><a href="/">home</a></nav>
	<div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
		<button onclick={streamTicks}>Stream (emit mode, paced)</button>
		<button onclick={streamList}>List (SSE []string)</button>
	</div>
	{#if ticks.length}
		<p>stream: {ticks.join(' | ')}</p>
	{/if}
	{#if listed.length}
		<p>list: {listed.join(' | ')}</p>
	{/if}
	{#if note}
		<p>{note}</p>
	{/if}
</main>
