<script lang="ts">
import { verbs_echo, verbs_probe } from '#routes/router/verbs/+page.v'

let note = $state('')

async function headProbe() {
	const res = await fetch('/router/verbs', {
		method: 'HEAD',
		headers: { accept: 'application/json' },
	})
	note = `HEAD /router/verbs → ${res.status} (GET arm answers HEAD)`
}

async function optionsProbe() {
	const res = await fetch('/router/verbs', { method: 'OPTIONS' })
	note = `OPTIONS /router/verbs → ${res.status} (CORS-preflight-only, no user fn)`
}

async function deleteProbe() {
	try {
		await verbs_probe({})
		// verbs_probe is the GET stub — force a DELETE through fetch instead.
		const res = await fetch('/router/verbs', {
			method: 'DELETE',
			headers: { accept: 'application/json' },
		})
		note = `DELETE /router/verbs → ${res.status} (no @[delete] arm → 405)`
	} catch (e) {
		note = String(e)
	}
}

async function echoProbe() {
	note = await verbs_echo({ payload: 'hi' })
}
</script>

<main>
	<h1>verbs (HEAD / OPTIONS / 405)</h1>
	<div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
		<button onclick={headProbe}>HEAD probe</button>
		<button onclick={optionsProbe}>OPTIONS probe</button>
		<button onclick={deleteProbe}>DELETE probe (405)</button>
		<button onclick={echoProbe}>POST ?echo</button>
	</div>
	{#if note}
		<p>{note}</p>
	{/if}
</main>
