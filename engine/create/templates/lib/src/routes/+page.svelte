<script lang="ts">
import type { HelloResult } from '#lib/hello/api.v'
import { hello } from '#lib/hello/api.v'

let name = $state('world')
let greeting: HelloResult = $state('')
let error = $state('')
</script>

<main>
	<h1>__NAME__ (library dogfood)</h1>
	<p>
		This demo route is local only — it is never published. It exercises the public
		<code>src/lib</code>
		surface exactly like a consumer would.
	</p>
	<input bind:value={name} placeholder="your name">
	<button
		onclick={async () => {
			error = ''
			try {
				greeting = await hello({ name })
			} catch (e) {
				error = String(e)
			}
		}}
	>
		Say hello (#lib WASM)
	</button>
	{#if greeting}
		<p>{greeting}</p>
	{/if}
	{#if error}
		<pre style="color:crimson">{error}</pre>
	{/if}
</main>
