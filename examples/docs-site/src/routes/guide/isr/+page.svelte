<script lang="ts">
import Code from '#lib/Code.svelte'
import DocsNav from '#lib/DocsNav.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>ISR</li>
	</ul>
</div>
<h1 class="text-4xl font-bold mt-2">Background ISR</h1>
<p class="py-4 opacity-80">
	Opt public pages into a native HTML cache. Fresh entries serve immediately; stale entries keep
	serving the previous HTML while the server regenerates the page in the background.
</p>
<div class="mt-2"><Code snippet={codeHtml['isr-config']} dense title="svelte.config.js" /></div>
<p class="opacity-80 mt-2">
	Longest path-prefix match wins. The native server reads the policy from
	<code>dist/isr.json</code>;
	<code>SWELTE_ISR</code>
	overrides it at runtime. SSR must be enabled and the cache directory writable.
</p>
<h2 class="text-2xl font-bold mt-8">Request lifecycle</h2>
<ol class="list-decimal list-inside opacity-80 space-y-2 mt-2">
	<li>A cold miss renders normally while scheduling background generation.</li>
	<li>A fresh entry serves immediately with <code>X-Swelte-Cache: HIT</code>.</li>
	<li>
		A stale entry serves the previous HTML with <code>X-Swelte-Cache: STALE</code> and schedules one
		regeneration per key.
	</li>
	<li>
		A successful render atomically replaces the cache file. A failed regeneration keeps the previous
		entry.
	</li>
</ol>
<p class="opacity-80 mt-2">
	Cache hits expose <code>Age</code> and public <code>Cache-Control</code> with
	<code>s-maxage</code>
	and <code>stale-while-revalidate</code>. Up to four regenerations run concurrently per process;
	shutdown tracks their work. Single-flight coordination is process-local.
</p>
<h2 class="text-2xl font-bold mt-8">Public page contract</h2>
<p class="opacity-80 mt-2">
	Only anonymous, queryless HTML GETs use this cache. Cookies, Authorization, query strings,
	JSON/navigation-data requests and <code>ssr=false</code> bypass it. Opt in pages whose anonymous
	content is public and independent of request-specific headers.
</p>
<p class="opacity-80 mt-2">
	Regeneration makes a fresh loopback request without credentials, through the normal guards and
	loads. Responses with cookies, explicit private/no-store policy, custom Vary, redirects, errors or
	an unrendered shell are not published. The cache stores the HTML body; load-specific response
	headers are not replayed on hits.
</p>
<h2 class="text-2xl font-bold mt-8">Cache ownership</h2>
<p class="opacity-80 mt-2">
	Files live in <code>dist/.swelte-isr</code>, keyed by host, path and shell. A shell change selects
	a new key, preventing obsolete asset references. The root SPA shell and application-owned static
	files are not rewritten. Processes sharing a directory get atomic reads and replacement, while
	each process schedules its own regeneration.
</p>
<DocsNav
	next={{ href: '/guide/images', label: 'Images' }}
	related={[
		{ href: '/guide/config', label: 'Config' },
		{ href: '/guide/ssr', label: 'SSR' },
	]}
/>
