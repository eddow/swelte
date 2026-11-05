<script lang="ts">
import Code from '#lib/Code.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>Agents</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Agents: MCP + skills</h1>
<p class="py-4 opacity-80">
	Two surfaces give agents programmatic insight (route tree, type contracts, diagnostics) instead of
	guessing from raw files.
</p>

<h2 class="text-2xl font-bold mt-8">MCP server (<code class="text-lg">@swelte/mcp</code>)</h2>
<p class="opacity-80 mt-2 text-sm">
	Transport is <strong>stdio only</strong> — the IDE spawns the server, no ports or auth.
</p>

<div class="mt-2">
	<Code snippet={codeHtml['mcp-json']} dense title="config" />
</div>
<p class="text-sm opacity-70 mt-2">Or via the bin: <code>swelte-mcp</code> (stdio, no args).</p>

<div class="overflow-x-auto mt-6">
	<table class="table table-zebra table-sm">
		<thead>
			<tr>
				<th>Tool</th>
				<th>What it does</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td><code>list_routes</code></td>
				<td>route tree: URL path, RPC fns, <code>.svelte</code> partner</td>
			</tr>
			<tr>
				<td><code>get_route</code></td>
				<td>one route in detail: V fns, structs, source</td>
			</tr>
			<tr>
				<td><code>check</code></td>
				<td><code>swelte check</code> diagnostics (orphans, clashes, backend violations)</td>
			</tr>
			<tr>
				<td><code>get_config</code></td>
				<td>resolved project config</td>
			</tr>
			<tr>
				<td><code>validate_data_contract</code></td>
				<td>V response struct vs Svelte <code>$props()</code> per-field match</td>
			</tr>
			<tr>
				<td><code>scaffold_route</code></td>
				<td>create a route pairing (<code>static | dynamic | api</code>)</td>
			</tr>
			<tr>
				<td><code>explain_bytecode_error</code></td>
				<td>QuickJS trace / wasm trap → source lines</td>
			</tr>
		</tbody>
	</table>
</div>

<h2 class="text-2xl font-bold mt-8">Skills</h2>
<p class="opacity-80 mt-2 text-sm">
	Six playbooks ship inside the npm packages — extracted automatically on
	<code>npm install</code>
	into <code>.agents/skills/</code> (scaffolded projects carry the <code>postinstall</code> hook). A
	skill tells the agent <em>how</em> to do the work, the MCP tool gives it the live project facts.
	Prefer MCP tools over grepping
	<code>src/routes/</code>
	by hand.
</p>
<div class="overflow-x-auto mt-2">
	<table class="table table-zebra table-sm">
		<thead>
			<tr>
				<th>Skill</th>
				<th>Ships in</th>
				<th>Use when</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td><code>swelte-overview</code></td>
				<td><code>@swelte/core</code></td>
				<td>scaffolding, explaining, navigating (layout, CLI, <code>.swelte/</code>)</td>
			</tr>
			<tr>
				<td><code>swelte-mcp</code></td>
				<td><code>@swelte/mcp</code></td>
				<td>querying via the MCP server (routes, contracts, diagnostics)</td>
			</tr>
			<tr>
				<td><code>swelte-ssr-load</code></td>
				<td><code>@swelte/ssr-qjs</code></td>
				<td>adding <code>@&#91;load]</code> data, debugging SSR output</td>
			</tr>
			<tr>
				<td><code>swelte-svelte5</code></td>
				<td><code>@swelte/core</code></td>
				<td>creating/fixing <code>.svelte</code> files (runes only)</td>
			</tr>
			<tr>
				<td><code>swelte-sveltekit-delta</code></td>
				<td><code>@swelte/core</code></td>
				<td>porting SvelteKit apps, checking parity</td>
			</tr>
			<tr>
				<td><code>swelte-v-routes</code></td>
				<td><code>@swelte/core</code></td>
				<td>creating/fixing <code>.v</code> files (attrs, request shape, types)</td>
			</tr>
		</tbody>
	</table>
</div>

<h2 class="text-2xl font-bold mt-8">Installing skills</h2>
<p class="opacity-80 mt-2 text-sm">
	Automatic — the scaffold template carries a <code>postinstall</code> hook (<code
		>npm-skills extract --skip-production --override</code
	>, scoped via <code>npmSkills.consume.only: ["@swelte/*"]</code> so unrelated
		packages are never resolved), so
	<code>npm install</code>
	drops each dependency's <code>skills/</code> into
	<code>.agents/skills/</code>. Versioned with the packages, no manual copy step.
</p>
