<script lang="ts">
// §1 ssr=false twin: SSR stays sync (renderRoute rejects async), the client
// compiles with experimental.async (vite.config.ts) so this <await>
// resolves in the browser. Hand serves the SPA shell (swelte_no_ssr),
// the async sibling load above stays client-only (never in render.js).
let { liveTag = 'none', paramsEcho = '{}', params = {} }: {
	liveTag?: string; paramsEcho?: string; params?: Record<string, string>
} = $props()
</script>

<main>
	<h1>router/live (ssr=false streaming twin)</h1>
	<nav><a href="/">home</a> · <a href="/router">router</a></nav>
	<p>async universal load: {liveTag} (params={paramsEcho}, route-params={JSON.stringify(params)})</p>

	<svelte:boundary>
		<p>{await Promise.resolve('streamed client fragment (async <await>, never SSR)')}</p>
		{#snippet pending()}
			<p>loading stream… (SPA-shell fallback)</p>
		{/snippet}
	</svelte:boundary>
</main>
