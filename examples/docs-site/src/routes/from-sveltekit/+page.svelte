<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>From SvelteKit</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Coming from SvelteKit</h1>
<p class="py-4 opacity-80">Svelte 5 stays on the frontend; V replaces the Node backend. File names look familiar on purpose — runtimes, data flow, and a few conventions differ.</p>

<div class="overflow-x-auto">
	<table class="table table-zebra table-sm">
		<thead><tr><th>SvelteKit</th><th>Swelte</th><th>Notes</th></tr></thead>
		<tbody>
			<tr><td><code>+page.svelte</code></td><td><code>+page.svelte</code> or <code>about.svelte</code></td><td>Same component, two spellings: <code>about.svelte</code> ⇔ <code>about/+page.svelte</code> (both → <code>/about</code>). One triple per URL — mixing <code>foo.*</code> + <code>foo/+page.*</code> is a build error.</td></tr>
			<tr><td><code>+page.ts / +page.server.ts</code></td><td><code>+page.v</code> + <code>+page.ts</code> (or flat <code>about.v</code> + <code>about.ts</code>)</td><td>Server <code>@&#91;load]</code> = initial paint; universal sibling = sync view-model transform (async only when <code>ssr=false</code>). <code>.svelte</code>/<code>.v</code> pair by mod path — no cross-pairing.</td></tr>
			<tr><td><code>+layout.svelte</code></td><td><code>+route.svelte</code></td><td>Wrapper per subtree, <code>children</code> snippet + <code>&#123;@render&#125;</code> outlet. SSR composes the chain server-side; client hydrates it in place.</td></tr>
			<tr><td><code>+layout.server.ts</code></td><td><code>+route.v (@&#91;load])</code></td><td>Same cascade slot. <code>(req)</code> at level 0, <code>(req, parent T)</code> deeper — typed value instead of parent() directly.</td></tr>
			<tr><td><code>+server.ts</code></td><td><code>SwelteResponse</code> in the leaf <code>.v</code></td><td>No standalone file. Verbs on the route file; full header/cookie/status/binary control.</td></tr>
			<tr><td><code>+error.svelte</code> (per-dir)</td><td>single global <code>+error.svelte</code></td><td>By design — <code>&#123; status?, message? &#125;</code>, renders server- and client-side.</td></tr>
			<tr><td><code>params/*.ts</code></td><td><code>src/matchers.v @&#91;matcher]</code></td><td>Central file + codegen'd JS mirrors. <code>[id=integer]</code> builtin.</td></tr>
			<tr><td><code>hooks.server.ts</code></td><td><code>+route.v</code> + <code>src/app.v</code></td><td>Subtree middleware stays local; <code>@&#91;startup]/@&#91;reroute]/@&#91;cron]</code> handle boot + rewrite + ticks.</td></tr>
			<tr><td><code>src/lib/server/*</code></td><td><code>src/lib/**/backend/</code></td><td>Physical: backend-only files are a build error from browser/WASM imports.</td></tr>
		</tbody>
	</table>
</div>

<h2 class="text-2xl font-bold mt-8">Data & rendering deltas</h2>
<ul class="list-disc list-inside opacity-80 space-y-1 mt-2 text-sm">
	<li><code>load</code> returns plain structs; no <code>fail(422, …)</code> helper — throw <code>!T</code> with a <code>&#123; ok: false, fieldErrors &#125;</code> body, narrow with <code>isFail(e)</code>.</li>
	<li>SSR is runtime-only (embedded QuickJS / sidecar), 50ms + 16MB budgets, SPA fallback. SSG is additive (<code>prerender.entries</code>).</li>
	<li>Aliases are <code>#routes / #lib</code> (hash style). <code>$app/stores|state|navigation</code> re-export the Swelte router; no <code>$app/forms</code>, no <code>$env/*</code>.</li>
	<li>Single artifact: <code>dist/server</code> + <code>dist/</code>. No Node at runtime.</li>
</ul>
