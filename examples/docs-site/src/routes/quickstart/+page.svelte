<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Quickstart</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Quickstart</h1>
<p class="py-4 opacity-80">One route file, one component. Server in V, UI in Svelte 5, typed bridge in between.</p>

<div class="grid lg:grid-cols-2 gap-4">
	<div>
		<h2 class="font-bold mb-2">Server — <code class="text-sm">src/routes/+page.v</code></h2>
		<div class="mockup-code text-xs">
			<pre data-prefix="1"><code>module plus_page</code></pre>
			<pre data-prefix="2"><code> </code></pre>
			<pre data-prefix="3"><code>@&#91;get]</code></pre>
			<pre data-prefix="4"><code>pub fn get_greeting(req SwelteRequest) string &#123;</code></pre>
			<pre data-prefix="5"><code>  name := req.query['payload'] or &#123; 'world' &#125;</code></pre>
			<pre data-prefix="6"><code>  return 'Hello, ' + name.trim('"') + '!'</code></pre>
			<pre data-prefix="7"><code>&#125;</code></pre>
			<pre data-prefix="8"><code> </code></pre>
			<pre data-prefix="9"><code>@&#91;post]</code></pre>
			<pre data-prefix="10"><code>pub fn save_name(req SwelteRequest) string &#123;</code></pre>
			<pre data-prefix="11"><code>  return 'saved:' + (req.form['payload'] or &#123; '' &#125;)</code></pre>
			<pre data-prefix="12"><code>&#125;</code></pre>
		</div>
	</div>
	<div>
		<h2 class="font-bold mb-2">Client — <code class="text-sm">src/routes/+page.svelte</code></h2>
		<div class="mockup-code text-xs">
			<pre data-prefix="1"><code>&lt;script lang="ts"&gt;</code></pre>
			<pre data-prefix="2"><code>  import &#123; get_greeting, save_name &#125; from '#routes/+page.v'</code></pre>
			<pre data-prefix="3"><code>  let name = $state('world')</code></pre>
			<pre data-prefix="4"><code>  let greeting = $state('')</code></pre>
			<pre data-prefix="5"><code>  function greet() &#123;</code></pre>
			<pre data-prefix="6"><code>    get_greeting(&#123; payload: name &#125;).then((g) =&gt; greeting = g)</code></pre>
			<pre data-prefix="7"><code>  &#125;</code></pre>
			<pre data-prefix="8"><code>&lt;/script&gt;</code></pre>
			<pre data-prefix="9"><code> </code></pre>
			<pre data-prefix="10"><code>&lt;input bind:value=&#123;name&#125; class="input input-bordered" /&gt;</code></pre>
			<pre data-prefix="11"><code>&lt;button onclick=&#123;greet&#125; class="btn btn-primary"&gt;Greet&lt;/button&gt;</code></pre>
		</div>
	</div>
</div>

<h2 class="text-2xl font-bold mt-8">Project shape</h2>
<div class="mockup-code text-xs mt-2">
	<pre data-prefix="1"><code>src/routes/   # server RPC (.v = handler, #routes/... import → fetch)</code></pre>
	<pre data-prefix="2"><code>src/lib/      # isomorphic (.v = local compute, #lib/... import → WASM)</code></pre>
	<pre data-prefix="3"><code>.swelte/      # generated types + stubs + harness (gitignored)</code></pre>
	<pre data-prefix="4"><code>dist/server   # single binary + dist/ static (prod)</code></pre>
</div>

<div class="flex gap-2 mt-6 flex-wrap">
	<a href="/guide/rpc" class="btn btn-primary btn-sm">Next: RPC & routes</a>
	<a href="/guide/forms" class="btn btn-ghost btn-sm">No-JS forms</a>
</div>
