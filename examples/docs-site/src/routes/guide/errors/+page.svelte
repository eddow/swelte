<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>Errors</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Errors</h1>
<p class="py-4 opacity-80">Every 4xx from the V backend is JSON. <code>SwelteRpcError(status, body, base, fn)</code> replaces thrown <code>error()</code>/<code>json()</code> helpers.</p>

<div class="mockup-code text-xs">
	<pre data-prefix="$"><code>curl -X POST /api/greet -H 'Accept: application/json' -d '&#123;"fn":"nope"&#125;'</code></pre>
	<pre data-prefix="&gt;"><code>&#123; "error": "unknown fn", "fn": "nope", "path": "/api/greet", "available": ["login"] &#125;</code></pre>
</div>

<div class="overflow-x-auto mt-6">
	<table class="table table-zebra table-sm">
		<thead><tr><th>Status</th><th>When</th></tr></thead>
		<tbody>
			<tr><td><span class="badge badge-error badge-sm">404</span></td><td>unknown <code>@&#91;rpc]</code> fn (+ <code>available</code> list), unknown path, unknown <code>?q</code> qualifier</td></tr>
			<tr><td><span class="badge badge-error badge-sm">400</span></td><td>missing <code>"fn"</code>, bad JSON, <code>!T</code> failure (<code>err.msg()</code>)</td></tr>
			<tr><td><span class="badge badge-error badge-sm">405</span></td><td>method without handler (DELETE with no <code>@&#91;delete]</code>)</td></tr>
			<tr><td><span class="badge badge-warning badge-sm">413</span></td><td>body over <code>SWELTE_BODY_LIMIT</code> (default 10MB)</td></tr>
			<tr><td><span class="badge badge-warning badge-sm">429</span></td><td>over <code>SWELTE_RATE_LIMIT</code> per IP window</td></tr>
			<tr><td><span class="badge badge-warning badge-sm">500</span></td><td>handler over <code>SWELTE_HANDLER_TIMEOUT_MS</code> (default 10s, server stays up)</td></tr>
		</tbody>
	</table>
</div>

<div class="alert alert-info mt-6">
	<span>Env knobs share one rule: unset, invalid, <code>0</code>, or negative → built-in default. <code>0</code> means default, never “off”.</span>
</div>

<h2 class="text-2xl font-bold mt-8">SPA-first proxy</h2>
<p class="opacity-80 mt-2 text-sm"><code>GET /</code> (no <code>?q=</code>, no JSON Accept) always serves the page — browser refresh never hits the API. Only JSON Accept, JSON bodies, and form bodies proxy to V. Exact <code>dist/</code> files win over both.</p>
