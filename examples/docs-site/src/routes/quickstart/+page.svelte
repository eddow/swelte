<script lang="ts">
import Code from '#lib/Code.svelte'
import DocsNav from '#lib/DocsNav.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Quickstart</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Quickstart</h1>
<p class="py-4 opacity-80">
	One route file, one component. Server in V, UI in Svelte 5, typed bridge in between.
</p>

<div class="grid lg:grid-cols-2 gap-4">
	<div>
		<h2 class="font-bold mb-2">Server — <code class="text-sm">src/routes/+page.v</code></h2>
		<Code snippet={codeHtml['quickstart-server']} dense />
	</div>
	<div>
		<h2 class="font-bold mb-2">Client — <code class="text-sm">src/routes/+page.svelte</code></h2>
		<Code snippet={codeHtml['quickstart-client']} dense />
	</div>
</div>

<h2 class="text-2xl font-bold mt-8">Project shape</h2>
<div class="mt-2">
	<Code snippet={codeHtml['quickstart-shape']} dense />
</div>

<DocsNav
	next={{ href: '/guide/rpc', label: 'RPC & routes' }}
	related={[{ href: '/guide/forms', label: 'Forms' }]}
/>
