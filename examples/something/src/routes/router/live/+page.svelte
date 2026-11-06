<script lang="ts">
import Streamed from './Streamed.svelte'

// §1 ssr=false twin: SSR stays sync (renderRoute rejects async), the client
// compiles with experimental.async (vite.config.ts) so <await> inside
// <svelte:boundary> resolves in the browser. Hand serves the SPA shell
// (swelte_no_ssr), the async sibling load above stays client-only
// (never in render.js).
//
// Client-router swap (routes.js): navigation mounts the new tree off-DOM,
// then inside one flushSync tears down the OLD tree first and swaps the new
// one in atomically — no blank flash, and no batch-null window where the old
// page's each-block commit (e.g. /router's {#each navigations}) can fire
// while this page's async boundary tracker is live. That overlap was the
// await_reactivity_loss `{#each ...}` warning on this page (which itself has
// no each block).
//
// Reactivity rule (Svelte await_reactivity_loss): the boundary's async
// region must not read parent $state after an await. So the streamed
// fragment lives in a child component — <Streamed/> reads NO parent
// state (static text only). Props are read directly in the sync template
// below (reactive, warning-free); nothing parent-owned crosses the
// boundary, so no snapshot consts are needed.
let {
	liveTag = 'none',
	paramsEcho = '{}',
	params = {},
}: {
	liveTag?: string
	paramsEcho?: string
	params?: Record<string, string>
} = $props()
</script>

<main>
	<h1>router/live (ssr=false streaming twin)</h1>
	<nav><a href="/">home</a> · <a href="/router">router</a></nav>
	<p>
		async universal load: {liveTag} (params={paramsEcho}, route-params={JSON.stringify(params)})
	</p>

	<svelte:boundary>
		<Streamed />
		{#snippet pending()}
			<p>loading stream… (SPA-shell fallback)</p>
		{/snippet}
	</svelte:boundary>
</main>
