<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>RPC & routes</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">RPC & routes</h1>
<p class="py-4 opacity-80">Every <code>.v</code> file is an ES module. Every <code>pub fn</code> with an attribute is a named export. Directory decides runtime: <code>#routes/</code> = server fetch, <code>#lib/</code> = local WASM call.</p>

<div class="alert alert-warning">
	<span>Named imports only: <code>import &#123; login &#125; from '#routes/api/greet.v'</code>.</span>
</div>

<h2 class="text-2xl font-bold mt-8">Directories</h2>
<div class="overflow-x-auto mt-2">
	<table class="table table-zebra">
		<thead><tr><th>Dir</th><th>Route?</th><th>Import</th><th>Runtime</th></tr></thead>
		<tbody>
			<tr><td><code>src/routes/**/*.v</code></td><td>file path is the URL (<code>api/greet.v</code> → <code>/api/greet</code>)</td><td><code>#routes/…</code></td><td>server fetch</td></tr>
			<tr><td><code>src/lib/**/*.v</code></td><td>never routed</td><td><code>#lib/…</code></td><td>WASM call</td></tr>
			<tr><td><code>src/lib/**/backend/</code></td><td>never</td><td>—</td><td><span class="badge badge-error badge-sm">backend-only</span> (build error from browser)</td></tr>
		</tbody>
	</table>
</div>

<h2 class="text-2xl font-bold mt-8">Attributes — the verb IS the method</h2>
<div class="overflow-x-auto mt-2">
	<table class="table table-zebra table-sm">
		<thead><tr><th>Attribute</th><th>HTTP</th><th>Notes</th></tr></thead>
		<tbody>
			<tr><td><code>@&#91;rpc]</code></td><td>POST JSON <code>&#123;fn, args&#125;</code></td><td>many per file; typed args-struct in, typed value out</td></tr>
			<tr><td><code>@&#91;get] / @&#91;get('q')]</code></td><td>GET (+HEAD)</td><td>query = args; default or <code>?q</code></td></tr>
			<tr><td><code>@&#91;post] / @&#91;put] / @&#91;patch] / @&#91;delete]</code></td><td>respective method</td><td>form fields = args; <code>File/Blob</code> → multipart</td></tr>
			<tr><td><code>@&#91;sse]</code></td><td>GET <code>Accept: text/event-stream</code></td><td>list mode <code>[]string</code> or emit mode; client is <code>AsyncGenerator</code></td></tr>
			<tr><td><code>@&#91;load]</code></td><td>— (page data)</td><td>zero/one per file, never stacked; <code>(req[, parent]) → !R</code></td></tr>
			<tr><td><code>@&#91;before] / @&#91;after]</code></td><td>— (middleware, <code>+route.v</code> only)</td><td>root→leaf / leaf→root; never exported to TS</td></tr>
		</tbody>
	</table>
</div>
<p class="text-sm opacity-70 mt-2">One default per verb per file (two <code>@&#91;post]</code> defaults = build error). Qualifiers must be unique per verb. No attribute = internal helper.</p>

<h2 class="text-2xl font-bold mt-8">Routing knobs</h2>
<ul class="list-disc list-inside opacity-80 space-y-1 mt-2">
	<li>A <code>+page.svelte</code> with no <code>+page.v</code> still renders (static shell/SPA + SSR); the leaf <code>.v</code> only claims the URL for API/RPC/load arms.</li>
	<li>Route groups <code>(group)</code> — disk-only, stripped from URL.</li>
	<li>Optional <code>[[slug]]</code> — last segment only, zero-or-one (<code>/docs</code> + <code>/docs/x</code> → 200).</li>
	<li>Dynamics <code>[id]</code>, <code>[id=integer]</code> (digits-only, <code>Params</code> narrows to <code>number</code>), catch-all <code>[...rest]</code>.</li>
	<li>Custom matchers in <code>src/matchers.v</code>: <code>@&#91;matcher] (s string) bool</code>, portable subset only.</li>
	<li>Wrappers <code>+route.svelte</code> (Svelte 5 <code>children</code> snippet) + <code>+route.v</code> middleware nest root→leaf.</li>
</ul>

<div class="flex gap-2 mt-6 flex-wrap">
	<a href="/guide/types" class="btn btn-primary btn-sm">Next: Types</a>
	<a href="/guide/forms" class="btn btn-ghost btn-sm">Forms</a>
</div>
