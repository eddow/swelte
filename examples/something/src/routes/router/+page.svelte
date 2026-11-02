<script lang="ts">
import { onMount } from 'svelte'
import { goto, preloadData, pushState, beforeNavigate, afterNavigate, page, navigating } from '@swelte/core'
import { page as appPage } from '$app/stores'
import { goto as navGoto } from '$app/navigation'

// §1 props contract: `leafProps = { params, ...data }` — server @[load]
// (RouterProps: greeting/ts, incl.iblingRows from swelte_fetch) merged with
// the universal sibling load (viewModel/paramsEcho/urlEcho, pure-sync).
// All async (fetch/db/…) lives in the .v server load — never here.
let { greeting = 'none', ts = '', siblingRows = '', viewModel = 'none', paramsEcho = '{}', urlEcho = '', params = {} }: {
	greeting?: string; ts?: string; siblingRows?: string; viewModel?: string; paramsEcho?: string; urlEcho?: string; params?: Record<string, string>
} = $props()

let probe = ''
let navigations: string[] = []
let guardNote = 'guard: armed (blocks /boom)'

async function doGoto() {
	probe = ''
	await goto('/router?who=goto')
}

async function doPreload() {
	const hit = await preloadData('/router?who=preload')
	probe = hit ? `preloaded ${hit.route} status=${hit.status} data=${JSON.stringify(hit.data).slice(0, 80)}` : 'no route'
}

async function doPush() {
	await pushState('/router?who=pushed', { page: { url: '/router?who=pushed', params: {}, route: '/router' } })
	probe = 'pushed state (URL changed, no DOM write)'
}

// Guards register client-side only: they must never fire during the
// sync SSR render (no router/stores in QJS — build error by design).
// NOTE: plain onMount still fires inside Svelte's sync server render,
// so guard with a browser check (false on the server output, so the
// calls are tree-shaken before QJS ever sees them).
import { browser } from '$app/environment'
if (browser) {
	onMount(() => {
		const offBefore = beforeNavigate((nav) => {
			// Cancellable guard demo: block programmatic trips to /boom.
			if (nav.to.startsWith('/boom')) {
				guardNote = 'guard: blocked trip to /boom'
				nav.cancel()
			}
		})
		const offAfter = afterNavigate((nav) => {
			navigations = [...navigations, `${nav.from} → ${nav.to.url}`].slice(-5)
		})
		return () => { offBefore(); offAfter() }
	})
}
</script>

<main>
	<h1>router (§1 client-router illustration)</h1>
	<nav><a href="/">home</a> · <a href="/admin">admin</a> · <a href="/boom">boom</a></nav>

	<!-- Server @[load] paint (+ in-process sibling rows) + universal sibling transform -->
	<p>server: {greeting} @ {ts}</p>
	<p>sibling (swelte_fetch, server-only): {siblingRows}</p>
	<p>universal: {viewModel} (params={paramsEcho}, url={urlEcho}, route-params={JSON.stringify(params)})</p>

	<!-- §1.4 router fns: goto / preloadData / pushState -->
	<div style="display:flex; gap:0.5rem; margin-top:0.5rem; flex-wrap:wrap;">
		<button onclick={doGoto}>goto (?who=goto)</button>
		<button onclick={doPreload}>preloadData</button>
		<button onclick={doPush}>pushState</button>
	</div>
	{#if probe}
		<p>{probe}</p>
	{/if}

	<!-- §1.4 guards + stores.
	     NOTE: $page/$navigating auto-subscriptions are client-only (the sync
	     QJS bundle has no store implementations — the imports are throw-stubs
	     there). They sit behind the same browser gate as the guards so SSR
	     never subscribes. -->
	{#if browser}
		<p>{guardNote} — <button onclick={() => goto('/boom')}>try goto(/boom)</button></p>
		{#if $navigating}
			<p>navigating {$navigating.from} → {$navigating.to}…</p>
		{/if}
		<p>page store: {$page.url} (route={$page.route})</p>
		<p>$app/stores + $app/navigation aliases resolve: {typeof appPage} / {typeof navGoto}</p>
	{/if}

	{#if navigations.length}
		<ul>
			{#each navigations as n}
				<li>{n}</li>
			{/each}
		</ul>
	{/if}

	<!-- Streaming lives on the ssr=false twin (/router/live): this route is
	     SSR-on, so sync renderRoute only. See ./live/+page.svelte. -->
	<p><a href="/router/live">streaming twin → /router/live (ssr=false, async &lt;await&gt;)</a></p>
</main>
