<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Versus</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Versus</h1>
<p class="py-4 opacity-80">
	Positioning: <strong>“Agents in, binaries out.”</strong> Systems-level performance without the
	cognitive friction — flat project structure, explicit types, predictable semantics.
</p>

<div class="grid lg:grid-cols-2 gap-4">
	<div class="card bg-base-100 border border-base-200">
		<div class="card-body">
			<h2 class="card-title text-base">vs SvelteKit / Next.js (Node/V8)</h2>
			<ul class="text-sm opacity-80 list-disc list-inside space-y-1">
				<li>Native machine code vs JIT'd JS; near-zero baseline memory</li>
				<li>Single self-contained binary — no <code>node_modules</code>, no process managers</li>
				<li>Zero GC overhead: deterministic memory with no V8 "stop-the-world" latency spikes</li>
				<li>
					True parallel multi-tasking: native concurrency without V8 single-thread event loop
					bottlenecks
				</li>
				<li>Instant peak performance: zero JIT compilation phase or warm-up time needed</li>
			</ul>
		</div>
	</div>
	<div class="card bg-base-100 border border-base-200">
		<div class="card-body">
			<h2 class="card-title text-base">vs Rust full-stack (Leptod/Dioxus + Axum)</h2>
			<ul class="text-sm opacity-80 list-disc list-inside space-y-1">
				<li>Low learning curve (Go/Python-inspired V, no borrow checker)</li>
				<li>Agent-friendly: flat structure, explicit types</li>
				<li>Svelte 5 runes — industry-standard reactivity</li>
			</ul>
		</div>
	</div>
	<div class="card bg-base-100 border border-base-200">
		<div class="card-body">
			<h2 class="card-title text-base">vs Go monolith (Go + embed)</h2>
			<ul class="text-sm opacity-80 list-disc list-inside space-y-1">
				<li>Unified <code>#lib/</code> isomorphic boundary — no manual serialization layers</li>
				<li>Native type-safe boundaries, clean route-level separation</li>
			</ul>
		</div>
	</div>
	<div class="card bg-base-100 border border-base-200">
		<div class="card-body">
			<h2 class="card-title text-base">vs Phoenix LiveView (Elixir)</h2>
			<ul class="text-sm opacity-80 list-disc list-inside space-y-1">
				<li>Full client autonomy — local WASM execution, offline-capable</li>
				<li>Instant local reactivity, no round-trip per interaction</li>
			</ul>
		</div>
	</div>
</div>

<div class="alert mt-6">
	<span
		>Choose <strong>.NET</strong> for regulated enterprise (SAP/Oracle bindings, EF Core, Orleans,
		FIPS/LTS). Choose <strong>Swelte</strong> for raw speed, single-binary simplicity, zero-ops,
		agent maintenance.</span
	>
</div>
