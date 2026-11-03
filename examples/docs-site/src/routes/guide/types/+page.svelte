<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>Types</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Types: V → TS projection</h1>
<p class="py-4 opacity-80">The Vite plugin reads <code>.v</code> files as text and writes <code>.swelte/types/**</code> + runtime stubs. V never emits TS; <code>tsc</code> never reads V.</p>

<div class="grid lg:grid-cols-2 gap-4">
	<div class="mockup-code text-xs">
		<pre data-prefix="1"><code>pub struct LoginArgs &#123; pub: payload string &#125;</code></pre>
		<pre data-prefix="2"><code>pub struct Session &#123; pub: id string ... &#125;</code></pre>
		<pre data-prefix="3"><code>@&#91;rpc] pub fn login(args LoginArgs) !Session &#123; ... &#125;</code></pre>
	</div>
	<div class="mockup-code text-xs">
		<pre data-prefix="1"><code>export interface Session &#123; id: string; ... &#125;</code></pre>
		<pre data-prefix="2"><code>export type LoginResult = Session;</code></pre>
		<pre data-prefix="3"><code>export function login(args: &#123; payload: string &#125;): Promise&lt;LoginResult&gt;;</code></pre>
	</div>
</div>

<h2 class="text-2xl font-bold mt-8">Type table</h2>
<div class="overflow-x-auto mt-2">
	<table class="table table-zebra table-sm">
		<thead><tr><th>V</th><th>TS</th></tr></thead>
		<tbody>
			<tr><td><code>string</code></td><td><code>string</code></td></tr>
			<tr><td><code>bool</code></td><td><code>boolean</code></td></tr>
			<tr><td><code>int / f64</code></td><td><code>number</code></td></tr>
			<tr><td><code>[]T</code></td><td><code>T[]</code></td></tr>
			<tr><td><code>[]u8</code></td><td><code>Blob</code></td></tr>
			<tr><td><code>map[string]T</code></td><td><code>Record&lt;string, unknown&gt;</code></td></tr>
			<tr><td><code>time.Time</code></td><td><code>number</code> (unix epoch)</td></tr>
			<tr><td><code>?T</code></td><td><code>T | null</code></td></tr>
			<tr><td><code>!T</code></td><td><code>T</code> + fallible (rejects with <code>SwelteRpcError</code>)</td></tr>
			<tr><td><code>SwelteResponse</code></td><td><code>&#123; status, headers, cookies, body &#125;</code></td></tr>
		</tbody>
	</table>
</div>

<div class="alert alert-info mt-6">
	<span>Per-route <code>RouteId</code> + <code>Params</code> types ship in every <code>types/routes/*.d.ts</code> — the <code>$types</code>-lite. Unknown names project <code>unknown</code> + warning.</span>
</div>
