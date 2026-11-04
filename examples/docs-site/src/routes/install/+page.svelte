<script lang="ts">
import Code from '#lib/Code.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Installation</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Installation</h1>
<p class="py-4 opacity-80">
	Requires Node 20+. V resolves itself — system <code>v</code>, else the
	<code>@swelte/vvm</code>
	toolchain. No manual V install. SSR is optional: core runs SPA/static + JSON out of the box; only
	install <code>@swelte/ssr-qjs</code> if you want server rendering (see
	<a class="link" href="/guide/ssr">SSR</a>).
</p>

<ul class="steps steps-vertical lg:steps-horizontal w-full my-4">
	<li class="step step-primary">Scaffold</li>
	<li class="step step-primary">Install</li>
	<li class="step">Dev</li>
	<li class="step">Build</li>
</ul>

<div class="mt-4">
	<Code snippet={codeHtml['install-steps']} />
</div>

<div class="grid md:grid-cols-2 gap-4 mt-6">
	<div class="card bg-base-100 border border-base-200">
		<div class="card-body">
			<h2 class="card-title">What you get</h2>
			<ul class="list-disc list-inside text-sm opacity-80 space-y-1">
				<li>
					<code>src/routes/</code>
					— server RPC (<code>.v</code>
					route handler, <code>#routes/…</code> import)
				</li>
				<li>
					<code>src/lib/</code>
					— isomorphic lib (<code>.v</code>
					local compute, <code>#lib/…</code> WASM call)
				</li>
				<li><code>.swelte/</code> — generated types, runtime stubs, server harness (never edit)</li>
			</ul>
		</div>
	</div>
	<div class="card bg-base-100 border border-base-200">
		<div class="card-body">
			<h2 class="card-title">Try it live</h2>
			<Code snippet={codeHtml['install-dev']} dense />
			<p class="text-sm opacity-70 mt-2">
				Every page here has a <code>+page.v</code> probe arm — the API dispatcher needs a leaf
				<code>.v</code>
				to claim the URL for JSON/RPC. A <code>+page.svelte</code> alone still renders (static
				shell/SPA + optional SSR); add the <code>+page.v</code> only when the route needs server
				data or callable arms.
			</p>
		</div>
	</div>
</div>

<div class="alert alert-success mt-6">
	<span
		>Open <a class="link" href="http://localhost:5174">http://localhost:5174</a> —
		<code>swelte dev</code>
		runs Vite + V backend in one command.</span
	>
</div>
