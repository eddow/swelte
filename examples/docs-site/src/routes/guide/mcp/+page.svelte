<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>MCP</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">MCP: <code class="text-2xl">@swelte/mcp</code> server</h1>
<p class="py-4 opacity-80">Gives IDE agents programmatic insight (route tree, type contracts, diagnostics) instead of guessing from raw files. Transport is <strong>stdio only</strong>.</p>

<div class="mockup-code text-xs">
	<pre data-prefix="1"><code>&#123; "mcpServers": &#123; "swelte": &#123; "command": "node",</code></pre>
	<pre data-prefix="2"><code>  "args": ["./node_modules/@swelte/mcp/dist/index.js"] &#125; &#125; &#125;</code></pre>
</div>
<p class="text-sm opacity-70 mt-2">Or via the bin: <code>swelte-mcp</code> (stdio, no args).</p>

<div class="overflow-x-auto mt-6">
	<table class="table table-zebra table-sm">
		<thead><tr><th>Tool</th><th>What it does</th></tr></thead>
		<tbody>
			<tr><td><code>list_routes</code></td><td>route tree: URL path, RPC fns, <code>.svelte</code> partner</td></tr>
			<tr><td><code>get_route</code></td><td>one route in detail: V fns, structs, source</td></tr>
			<tr><td><code>check</code></td><td><code>swelte check</code> diagnostics (orphans, clashes, backend violations)</td></tr>
			<tr><td><code>get_config</code></td><td>resolved project config</td></tr>
			<tr><td><code>validate_data_contract</code></td><td>V response struct vs Svelte <code>$props()</code> per-field match</td></tr>
			<tr><td><code>scaffold_route</code></td><td>create a route pairing (<code>static | dynamic | api</code>)</td></tr>
			<tr><td><code>explain_bytecode_error</code></td><td>QuickJS trace / wasm trap → source lines</td></tr>
		</tbody>
	</table>
</div>
