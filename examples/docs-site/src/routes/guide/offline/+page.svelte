<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>Offline</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Offline (service worker)</h1>
<p class="py-4 opacity-80">
	Opt-in offline shell. Disabled by default — zero SW bytes, zero registration, SPA-first unchanged.
</p>

<div class="alert alert-info">
	<span
		>Enable with <code>swelte.serviceWorker.enabled: true</code> in <code>svelte.config.js</code> or
		<code>SWELTE_SW=1</code> in the env (env wins). See <code>docs/config.md</code> §Service worker
		+ §Offline fallback page.</span
	>
</div>

<h2 class="text-2xl font-bold mt-8">What the build emits</h2>
<ul class="list-disc list-inside opacity-80 space-y-1 mt-2">
	<li>Additive <code>dist/sw.js</code> only — the single-artifact default never changes.</li>
	<li>
		Hand-rolled precache (no workbox dep): <code>/</code> + hashed <code>assets/*.js</code> +
		<code>assets/*.wasm</code>; cache version = <code>version</code> stamp, old caches purged on
		activate.
	</li>
	<li>
		<code>offline.fallback</code>
		page precached only when configured <em>and</em> the prerender pass wrote it.
	</li>
</ul>

<h2 class="text-2xl font-bold mt-8">Registration</h2>
<ul class="list-disc list-inside opacity-80 space-y-1 mt-2">
	<li><code>register: 'auto'</code> (default) injects a same-origin registration snippet.</li>
	<li>
		<code>register: 'manual'</code>
		emits <code>dist/sw.js</code> but skips the snippet — the app registers itself.
	</li>
</ul>

<h2 class="text-2xl font-bold mt-8">Runtime scope</h2>
<ul class="list-disc list-inside opacity-80 space-y-1 mt-2">
	<li>GET navigations + immutable assets are cache-first with SPA-shell offline fallback.</li>
	<li>
		<code>Accept: application/json</code>
		/ <code>text/event-stream</code> / POST / <code>/api/*</code> are network-only — offline the
		caller sees the failure, never stale JSON.
	</li>
	<li><code>#lib/</code> WASM rides the same immutable-asset cache.</li>
	<li>
		<code>Hand</code>
		serves exact <code>dist/</code> files (incl. <code>sw.js</code>) regardless of Accept — real
		files win over the SPA-first proxy rule.
	</li>
</ul>

<div class="flex gap-2 mt-6 flex-wrap">
	<a href="/guide/config" class="btn btn-primary btn-sm">Back: Config</a>
	<a href="/guide/ssr" class="btn btn-ghost btn-sm">SSR</a>
</div>
