<script lang="ts">
	import DocsNav from '#lib/DocsNav.svelte'
	import Code from '#lib/Code.svelte'
	import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Example app</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Example: <code class="text-2xl">something</code></h1>
<p class="py-4 opacity-80">
	Canonical demo of <code>.v</code> imports: <code>#routes/</code> server RPC +
	<code>#lib/</code>
	isomorphic WASM + structured errors. Built with <code>swelte build</code>, served with
	<code>swelte preview</code>.
</p>

<h2 class="text-2xl font-bold">Route tour</h2>
<div class="overflow-x-auto mt-2">
	<table class="table table-zebra table-sm">
		<thead>
			<tr>
				<th>Route</th>
				<th>What it proves</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td><code>/</code></td>
				<td>GET + POST + fail-lite <code>?save</code> 422 + narrow-args + PUT/PATCH aliases</td>
			</tr>
			<tr>
				<td><code>/api/greet</code></td>
				<td><code>@&#91;rpc]</code> typed session, login cookie, slow/stream probes, PDF + 201</td>
			</tr>
			<tr>
				<td><code>/session</code></td>
				<td><code>+route</code> locals bag, cookie set/delete, <code>303</code> redirect</td>
			</tr>
			<tr>
				<td><code>/router</code></td>
				<td>
					client router: <code>goto / preloadData / pushState</code>, guards,
					<code>page.form</code>, SSE
				</td>
			</tr>
			<tr>
				<td><code>/members/[id=integer]</code></td>
				<td>narrowed digits-only param + <code>entries.ts</code> prerender expansion</td>
			</tr>
			<tr>
				<td><code>/posts/[slug=slug]</code></td>
				<td>custom matcher (lowercase-alpha) on V dispatch + client</td>
			</tr>
			<tr>
				<td><code>/admin</code></td>
				<td>wrapper nav + <code>@&#91;before]</code> session guard</td>
			</tr>
			<tr>
				<td><code>/boom</code></td>
				<td>throw fixture — SSR <code>!T</code> gate to <code>+error</code></td>
			</tr>
		</tbody>
	</table>
</div>

<h2 class="text-2xl font-bold mt-8">Live RPC demo</h2>
<p class="text-sm opacity-70 mt-2">
	This page is static prose, but the same stubs power the interactive demo below (server fetch on
	<code>#routes/</code>, WASM on <code>#lib/</code>):
</p>

<div class="mt-2">
	<Code snippet={codeHtml['example-imports']} dense />
</div>

<div class="alert alert-info mt-6">
	<span
		>Run it: <code>npm run dev --workspace=examples/something</code> — then compare this page's
		source with <code>examples/something/src/routes/+page.svelte</code>.</span
	>
</div>
<DocsNav related={[{ href: '/guide/rpc', label: 'RPC & routes' }, { href: '/from-sveltekit', label: 'From SvelteKit' }]} />
