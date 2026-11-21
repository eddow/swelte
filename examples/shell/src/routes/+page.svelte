<script lang="ts">
import { get_greeting } from '#routes/+page.v'

let name = $state('world')
let greeting = $state('')
let note = $state('')

async function greet() {
	note = ''
	try {
		greeting = await get_greeting({ payload: name })
	} catch (e) {
		note = e instanceof Error ? e.message : String(e)
	}
}
</script>

<main>
	<h1>Swelte example: shell</h1>
	<p>
		One shared backend shell, two faces: a <strong>chat</strong> pane and a
		<strong>terminal</strong> pane. Human keystrokes run instantly (allowlisted); AI-proposed
		commands wait for a human approval — approved exactly once.
	</p>
	<nav>
		<ul>
			<li><a href="/shell/ai">/shell/ai</a> — chat + approval queue + live terminal</li>
		</ul>
	</nav>
	<h2>backend probe</h2>
	<p>
		<label>name <input bind:value={name} placeholder="your name"></label>
		<button onclick={greet}>Greet (#routes GET /)</button>
	</p>
	{#if greeting}
		<p>{greeting}</p>
	{/if}
	{#if note}
		<pre style="color:crimson; white-space:pre-wrap;">{note}</pre>
	{/if}
	<p>
		Powered by <code>@swelte/ai</code> building blocks (envelope, draft, trace, capability routing)
		over the Swelte RPC/SSE/WS transport.
	</p>
</main>
