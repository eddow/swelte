<script lang="ts">
	import Code from '#lib/Code.svelte';
	import { codeHtml } from '#lib/snippets.gen.js';
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>Forms</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Forms + fail + deserialize</h1>
<p class="py-4 opacity-80">No <code>actions&#123;&#125;</code> namespace. One default fn per verb per file, <code>?q</code> qualifiers for many-per-file. Same handler serves no-JS and fetch — content-negotiated.</p>

<h2 class="text-2xl font-bold">Verbs + <code>?q</code></h2>
<div class="grid lg:grid-cols-2 gap-4 mt-2">
	<Code snippet={codeHtml['forms-html']} dense />
	<Code snippet={codeHtml['forms-v']} dense />
</div>

<h2 class="text-2xl font-bold mt-8">No-JS</h2>
<p class="opacity-80 mt-2">Browser navigations (<code>Accept: text/html</code>) bypass JSON: success → <code>303</code> + <code>Location</code>, failure → rendered HTML error page. Fetch keeps JSON. <code>GET</code> never redirects.</p>

<h2 class="text-2xl font-bold mt-8">Fail-lite</h2>
<div class="mt-2">
	<Code snippet={codeHtml['forms-fail']} dense />
</div>
<p class="text-sm opacity-70 mt-2">Convention: throw <code>!T</code> with a <code>&#123; ok: false, fieldErrors &#125;</code> JSON body; narrow client-side with <code>isFail(e, status?)</code>.</p>

<h2 class="text-2xl font-bold mt-8">use:enhance</h2>
<div class="mt-2">
	<Code snippet={codeHtml['forms-enhance']} dense />
</div>
<p class="opacity-80 mt-2 text-sm">No-JS untouched. With JS, the submit replays as <code>fetch</code> and folds into <code>page.form</code> (<code>failure</code> stays inline, never <code>page.error</code>). <code>applyAction(result)</code> is also usable standalone.</p>
