<div class="hero bg-base-200 rounded-box">
	<div class="hero-content text-center py-16">
		<div class="max-w-2xl">
			<div class="badge badge-primary mb-4">V + Svelte 5</div>
			<h1 class="text-5xl font-bold">Swelte</h1>
			<p class="py-6 text-lg opacity-80">
				V is the compute engine (native server binary, WASM client modules). Svelte 5 is the
				UI. One RPC protocol bridges them. Agents in, binaries out.
			</p>
			<div class="flex gap-2 justify-center flex-wrap">
				<a href="/install" class="btn btn-primary">Get started</a>
				<a href="/guide/rpc" class="btn btn-outline">Read the guide</a>
				<a href="/from-sveltekit" class="btn btn-ghost">Coming from SvelteKit?</a>
			</div>
		</div>
	</div>
</div>

<div class="grid md:grid-cols-3 gap-4 mt-8">
	<div class="card bg-base-100 border border-base-200">
		<div class="card-body">
			<h2 class="card-title">Server RPC</h2>
			<p class="opacity-70 text-sm">
				<code>.v</code> route handlers import straight into <code>.svelte</code> — verbs,
				SSE, typed structs.
			</p>
			<div class="card-actions justify-end">
				<a href="/guide/rpc" class="btn btn-sm">RPC & routes</a>
			</div>
		</div>
	</div>
	<div class="card bg-base-100 border border-base-200">
		<div class="card-body">
			<h2 class="card-title">Isomorphic lib</h2>
			<p class="opacity-70 text-sm">
				<code>src/lib</code> compiles native + WASM. Same V, local call, no fetch.
			</p>
			<div class="card-actions justify-end">
				<a href="/guide/types" class="btn btn-sm">Types</a>
			</div>
		</div>
	</div>
	<div class="card bg-base-100 border border-base-200">
		<div class="card-body">
			<h2 class="card-title">Single binary</h2>
			<p class="opacity-70 text-sm">
				<code>swelte build</code> emits <code>dist/server</code> + <code>dist/</code>. No
				Node at runtime.
			</p>
			<div class="card-actions justify-end">
				<a href="/guide/cli" class="btn btn-sm">CLI</a>
			</div>
		</div>
	</div>
</div>

<div class="mockup-code mt-8">
	<pre data-prefix="1"><code>npx swelte init myapp &amp;&amp; cd myapp</code></pre>
	<pre data-prefix="2"><code>npm install</code></pre>
	<pre data-prefix="3"><code>npx swelte dev    # Vite :5174 + V backend :8131</code></pre>
</div>

<div class="alert alert-info mt-8">
	<svg
		xmlns="http://www.w3.org/2000/svg"
		fill="none"
		viewBox="0 0 24 24"
		class="stroke-current shrink-0 w-6 h-6"
	>
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
		></path>
	</svg>
	<span>Docs live in <code>docs/*.md</code> — these pages render the same content.</span>
</div>
