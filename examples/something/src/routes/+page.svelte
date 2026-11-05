<script lang="ts">
import { get_greeting } from '#routes/+page.v'

let apiNote = $state('')
let apiError = $state('')

async function probe(label: string, path: string) {
	apiNote = ''
	apiError = ''
	try {
		const res = await fetch(path, { headers: { accept: 'application/json' } })
		const text = await res.text()
		apiNote = res.ok ? `${label} → ${text}` : `${label} → ${res.status}: ${text}`
	} catch (e) {
		apiError = `${label} → ${String(e)}`
	}
}
</script>

<main>
	<h1>Swelte example: something</h1>
	<p>One concept per route — pick a room:</p>
	<nav>
		<ul>
			<li><a href="/rpc">rpc</a> — verbs + @[rpc] + narrow-args + fail-lite</li>
			<li><a href="/stream">stream</a> — SSE emit + list</li>
			<li><a href="/chat">chat</a> — room SSE + WS echo + WS rooms (one hub)</li>
			<li><a href="/store">store</a> — embedded KV + hub listeners</li>
			<li><a href="/wasm">wasm</a> — #lib isomorphic hash</li>
			<li><a href="/types">types</a> — TypeRow + narrow + bytes</li>
			<li><a href="/session">session</a> — locals + cookies + redirect</li>
			<li><a href="/admin">admin</a> — before/after guard + layout contract</li>
			<li><a href="/router">router</a> — load + client router + <a href="/router/live">live</a> + <a href="/router/tags">tags</a> + <a href="/router/verbs">verbs</a> + <a href="/router/enhance">enhance</a></li>
			<!-- Headless API demos (no +page.svelte — fetch probes, not links:
			     navigating to these shows the SPA 404 by design, no request) -->
			<li>
				dynamics, matchers, groups, catch-all —
				<button onclick={() => probe('users/42', '/users/42')}>users/42</button>
				<button onclick={() => probe('members/42', '/members/42')}>members/42</button>
				<button onclick={() => probe('posts/hello', '/posts/hello')}>posts/hello</button>
				<button onclick={() => probe('files/a/b', '/files/a/b')}>files/a/b</button>
				<button onclick={() => probe('docs', '/docs')}>docs</button>
				<button onclick={() => probe('about', '/about')}>about</button>
			</li>
			<li><a href="/boom">boom</a> — throw gate (+error)</li>
		</ul>
	</nav>
	{#if apiNote}<p>{apiNote}</p>{/if}
	{#if apiError}<pre style="color:crimson; white-space:pre-wrap;">{apiError}</pre>{/if}
	<p><button onclick={() => get_greeting({ payload: 'hub' })}>hub probe (GET /)</button></p>
</main>
