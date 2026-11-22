<script lang="ts">
import DocsNav from '#lib/DocsNav.svelte'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>CLI</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">CLI: <code class="text-2xl">swelte</code> commands</h1>
<p class="py-4 opacity-80">
	Every command resolves the V toolchain itself (system <code>v</code>, else
	<code>@swelte/vvm</code>). Closed subcommand list — no aliases.
</p>

<p class="pb-4 opacity-80">
	One project shape supports two build targets: <code>swelte build</code> builds the application
	into <code>dist/</code>; <code>swelte package</code> builds reusable <code>src/lib</code> code
	into separate <code>package/</code> output. Routes belong to the application or local demo and
	never ship to consumers. The scaffolder asks about samples and SSR, with no app/library kind
	selection.
</p>

<div class="border border-base-300 rounded-box overflow-hidden divide-y divide-base-300">
	<div class="collapse collapse-arrow">
		<input type="radio" name="cli-acc" checked>
		<div class="collapse-title font-mono text-sm">
			swelte dev [--port N] [--backend N] [--root dir]
		</div>
		<div class="collapse-content text-sm opacity-80">
			<p>
				One command: V backend + Vite, HMR reload on <code>.v</code> change.
				<code>generate()</code>
				runs once pre-Vite so <code>.swelte/</code> exists. Dev sets same-origin
				<code>SWELTE_CORS_ORIGIN</code>; compare-then-write keeps idle dev quiet.
			</p>
		</div>
	</div>
	<div class="collapse collapse-arrow">
		<input type="radio" name="cli-acc">
		<div class="collapse-title font-mono text-sm">
			swelte build [--target auto|static|node|edge] [--target-os linux|macos|windows]
		</div>
		<div class="collapse-content text-sm opacity-80">
			<ol class="list-decimal list-inside space-y-1">
				<li>
					<code>generate()</code>
					into <code>.swelte/</code> (+ <code>entries.json</code> crawl list)
				</li>
				<li><code>vite build</code> (wipes <code>dist/</code> first)</li>
				<li>QJS bridge → <code>dist/ssr/render.js</code></li>
				<li><code>v -o dist/server .swelte/server.v</code> (single artifact)</li>
				<li>prerender crawl → additive <code>dist/*/index.html</code></li>
				<li>smoke: boot binary, probe <code>/</code> + <code>/api/greet</code></li>
			</ol>
		</div>
	</div>
	<div class="collapse collapse-arrow">
		<input type="radio" name="cli-acc">
		<div class="collapse-title font-mono text-sm">
			swelte package [--input dir] [--output dir] [--no-types]
		</div>
		<div class="collapse-content text-sm opacity-80">
			<p>
				Builds <code>src/lib</code> (or configured <code>swelte.libDir</code>) into
				<code>package/</code>: JS, Svelte sources and declarations. Declared V modules ship as raw
				sources for consumer compilation. No routes or V compiler required. Validates publication
				metadata before building and fails on invalid exports, missing library files or route
				leakage. <code>swelte check --lib</code> reports the same metadata diagnostics without
				writing output.
			</p>
			<p>
				Every starter has <code>build</code> and <code>package</code> scripts and starts private.
				Declare public exports and remove <code>private: true</code> when ready to publish.
				<code>--template lib</code> selects the reusable V sample content.
			</p>
		</div>
	</div>
	<div class="collapse collapse-arrow">
		<input type="radio" name="cli-acc">
		<div class="collapse-title font-mono text-sm">swelte test [--update-snapshot]</div>
		<div class="collapse-content text-sm opacity-80">
			<p>
				<code>generate()</code>
				→ <code>v test</code> per dir → contract check (types↔stubs parity) → shape snapshot in
				<code>swelte.contract.json</code>
				(committed, drift = fail).
			</p>
		</div>
	</div>
	<div class="collapse collapse-arrow">
		<input type="radio" name="cli-acc">
		<div class="collapse-title font-mono text-sm">
			swelte migrate [--root dir] [--db path] (Plus db plugin)
		</div>
		<div class="collapse-content text-sm opacity-80">
			<p>
				Resolved from the project's configured
				<code>swelte(&#123; plugins: [dbPlugin] &#125;)</code> entry (<code>@swelte/plus/db</code>)
				— see the <a href="/plus/db" class="link">Database</a> page. Core alone ships no
				<code>migrate</code>.
			</p>
		</div>
	</div>
	<div class="collapse collapse-arrow">
		<input type="radio" name="cli-acc">
		<div class="collapse-title font-mono text-sm">
			swelte preview / export / check (+ npm create @swelte)
		</div>
		<div class="collapse-content text-sm opacity-80">
			<ul class="list-disc list-inside space-y-1">
				<li><code>preview</code> — serve the built binary, Vite-less prod run</li>
				<li>
					<code>export</code>
					— snapshot the crawl (<code>entries.json</code>
					+ HTML + contract → <code>snapshot/</code>)
				</li>
				<li>
					<code>check</code>
					— diagnostics, no side effects (<code>--format text|json</code>; json is the agent/CI
					shape, same as MCP <code>check</code>)
				</li>
				<li>
					<code>npm create @swelte</code>
					— scaffold a Swelte project (<code>--sample</code>
					/ <code>--empty</code> / <code>--template lib</code> / <code>--ssr</code>)
				</li>
			</ul>
		</div>
	</div>
</div>
<DocsNav
	next={{ href: '/guide/mcp', label: 'Agents' }}
	related={[{ href: '/guide/ssr', label: 'SSR' }]}
/>
