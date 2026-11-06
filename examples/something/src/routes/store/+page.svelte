<script lang="ts">
import { SwelteRpcError } from '@swelte/core'
import { hub_count, kv_drop, kv_read, kv_write } from '#routes/api/store.v'

let key = $state('demo-key')
let value = $state('demo-value')
let out = $state('')
let room = $state('lobby')

function showError(e: unknown) {
	if (e instanceof SwelteRpcError) out = e.message
	else out = String(e)
}

async function write() {
	out = ''
	try {
		out = await kv_write({ key, value })
	} catch (e) {
		showError(e)
	}
}

async function read() {
	out = ''
	try {
		out = await kv_read({ key })
	} catch (e) {
		showError(e)
	}
}

async function drop() {
	out = ''
	try {
		out = await kv_drop({ key })
	} catch (e) {
		showError(e)
	}
}

async function listeners() {
	out = ''
	try {
		out = `listeners(${room}): ${await hub_count({ room })}`
	} catch (e) {
		showError(e)
	}
}
</script>

<main>
	<h1>store (embedded KV + hub listeners)</h1>
	<nav><a href="/">home</a> · <a href="/chat">chat</a></nav>
	<p>
		<label>key <input bind:value={key}></label>
		<label>value <input bind:value></label>
	</p>
	<div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
		<button onclick={write}>write</button>
		<button onclick={read}>read</button>
		<button onclick={drop}>delete</button>
	</div>
	<p>
		<label>room <input bind:value={room}></label>
		<button onclick={listeners}>hub listeners</button>
	</p>
	{#if out}
		<p>{out}</p>
	{/if}
</main>
