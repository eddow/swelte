<script lang="ts">
import { tick } from 'svelte'
import { RunTracker, capabilityFailure } from '#lib/index.js'
import { DeterministicAdapter } from '#lib/adapters.js'

let status = $state('idle')
let reply = $state('')
let verdict = $state('')
let lastError = $state('')

function showError(e: unknown) {
	lastError = e instanceof Error ? e.message : String(e)
}

async function runDemo() {
	lastError = ''
	status = 'running'
	reply = ''
	try {
		const tracker = new RunTracker()
		verdict = capabilityFailure({ input: ['video'], output: ['text'] }, [])
		const adapter = new DeterministicAdapter()
		for await (const event of adapter.run('hello dogfood', { input: ['text'], output: ['text'] })) {
			if (event.envelope.kind === 'text.delta') reply += (event.payload as { text: string }).text
			if (event.envelope.kind === 'terminal') tracker.finish('completed', event.envelope.seq)
			await tick()
		}
		status = tracker.isTerminal ? 'done' : 'open'
	} catch (e) {
		showError(e)
		status = 'error'
	}
}
</script>

<main>
	<h1>@swelte/ai library dogfood — never published</h1>
	<p>
		This demo route is local only — it is never published. It exercises the public
		<code>src/lib</code>
		surface exactly like a consumer would.
	</p>
	<button onclick={runDemo}>Run deterministic run (#lib)</button>
	{#if reply}
		<p>reply: {reply}</p>
	{/if}
	{#if verdict}
		<p>video check: {verdict}</p>
	{/if}
	<p>status: {status}</p>
	{#if lastError}
		<pre style="color:crimson; white-space:pre-wrap;">{lastError}</pre>
	{/if}
</main>
