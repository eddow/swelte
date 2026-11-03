<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>CLI</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">CLI: <code class="text-2xl">swelte</code> commands</h1>
<p class="py-4 opacity-80">Every command resolves the V toolchain itself (system <code>v</code>, else <code>@swelte/vvm</code>). Closed subcommand list — no aliases.</p>

<div class="border border-base-300 rounded-box overflow-hidden divide-y divide-base-300">
	<div class="collapse collapse-arrow">
		<input type="radio" name="cli-acc" checked />
		<div class="collapse-title font-mono text-sm">swelte dev [--port N] [--backend N] [--root dir]</div>
		<div class="collapse-content text-sm opacity-80">
			<p>One command: V backend + Vite, HMR reload on <code>.v</code> change. <code>generate()</code> runs once pre-Vite so <code>.swelte/</code> exists. Dev sets same-origin <code>SWELTE_CORS_ORIGIN</code>; compare-then-write keeps idle dev quiet.</p>
		</div>
	</div>
	<div class="collapse collapse-arrow">
		<input type="radio" name="cli-acc" />
		<div class="collapse-title font-mono text-sm">swelte build [--target auto|static|node|edge] [--target-os linux|macos|windows]</div>
		<div class="collapse-content text-sm opacity-80">
			<ol class="list-decimal list-inside space-y-1">
				<li><code>generate()</code> into <code>.swelte/</code> (+ <code>entries.json</code> crawl list)</li>
				<li><code>vite build</code> (wipes <code>dist/</code> first)</li>
				<li>QJS bridge → <code>dist/ssr/render.js</code></li>
				<li><code>v -o dist/server .swelte/server.v</code> (single artifact)</li>
				<li>prerender crawl → additive <code>dist/*/index.html</code></li>
				<li>smoke: boot binary, probe <code>/</code> + <code>/api/greet</code></li>
			</ol>
		</div>
	</div>
	<div class="collapse collapse-arrow">
		<input type="radio" name="cli-acc" />
		<div class="collapse-title font-mono text-sm">swelte test [--update-snapshot]</div>
		<div class="collapse-content text-sm opacity-80">
			<p><code>generate()</code> → <code>v test</code> per dir → contract check (types↔stubs parity) → shape snapshot in <code>swelte.contract.json</code> (committed, drift = fail).</p>
		</div>
	</div>
	<div class="collapse collapse-arrow">
		<input type="radio" name="cli-acc" />
		<div class="collapse-title font-mono text-sm">swelte preview / export / check / init</div>
		<div class="collapse-content text-sm opacity-80">
			<ul class="list-disc list-inside space-y-1">
				<li><code>preview</code> — serve the built binary, Vite-less prod run</li>
				<li><code>export</code> — snapshot the crawl (<code>entries.json</code> + HTML + contract → <code>snapshot/</code>)</li>
				<li><code>check</code> — diagnostics, no side effects (<code>--format json</code> for agents)</li>
				<li><code>init</code> — scaffold (<code>--sample</code> / <code>--empty</code>); routers never scaffolded</li>
			</ul>
		</div>
	</div>
</div>
