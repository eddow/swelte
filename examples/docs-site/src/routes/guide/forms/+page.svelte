<script lang="ts">
import Code from '#lib/Code.svelte'
import DocsNav from '#lib/DocsNav.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>Forms</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Forms + fail + deserialize</h1>
<p class="py-4 opacity-80">
	No <code>actions&#123;&#125;</code> namespace. One default fn per verb per file,
	<code>?q</code>
	qualifiers for many-per-file. Same handler serves no-JS and fetch — content-negotiated.
</p>

<h2 class="text-2xl font-bold">Verbs + <code>?q</code></h2>
<div class="grid lg:grid-cols-2 gap-4 mt-2">
	<Code snippet={codeHtml['forms-html']} dense />
	<Code snippet={codeHtml['forms-v']} dense />
</div>

<h2 class="text-2xl font-bold mt-8">No-JS</h2>
<p class="opacity-80 mt-2">
	Browser navigations (<code>Accept: text/html</code>) bypass JSON: success → <code>303</code> +
	<code>Location</code>, failure → the target page rendered with form data and its failure status.
	Fetch keeps JSON.
	<code>GET</code>
	loads may independently redirect through their load envelope.
</p>

<h2 class="text-2xl font-bold mt-8">Fail-lite</h2>
<div class="mt-2">
	<Code snippet={codeHtml['forms-fail']} dense />
</div>
<p class="text-sm opacity-70 mt-2">
	Convention: throw <code>!T</code> with a <code>&#123; ok: false, fieldErrors &#125;</code> JSON
	body; narrow client-side with <code>isFail(e, status?)</code>.
</p>

<h2 class="text-2xl font-bold mt-8">use:enhance</h2>
<div class="mt-2">
	<Code snippet={codeHtml['forms-enhance']} dense />
</div>
<p class="opacity-80 mt-2 text-sm">
	No-JS untouched. With JS, the submit replays as <code>fetch</code> and folds into
	<code>page.form</code>
	(<code>failure</code>
	stays inline, never <code>page.error</code>). <code>applyAction(result)</code> is also usable
	standalone.
</p>
<h2 class="text-2xl font-bold mt-8">Named actions and compatibility</h2>
<p class="opacity-80 mt-2">
	Set <code>swelte.actionQuery: 'named'</code> to use
	<code>?/save</code>. Named actions preserve search parameters such as <code>q</code>;
	<code>?/save&amp;q=hello</code>
	redirects to <code>?q=hello</code> on no-JS success. Legacy mode retains <code>?q=save</code> and
	<code>?save</code>.
	<code>swelte.compat: 'sveltekit'</code>
	selects named actions by default and supplies nested data/form props, reactive
	<code>$app/state</code>
	and the <code>$app/forms</code> adapter.
</p>
<h2 class="text-2xl font-bold mt-8">Submission lifecycle</h2>
<p class="opacity-80 mt-2">
	Enhancement prevents native submission synchronously. Cancellation stops submission; submitter
	overrides and multipart file bytes are retained. Failures stay inline. Success can reset the form
	and awaits the current page's load refresh, preserving component state. Cross-page submissions do
	not overwrite unrelated form state. The native callback API remains available; the compatibility
	adapter supplies result and update fields.
</p>
<DocsNav
	next={{ href: '/guide/errors', label: 'Errors' }}
	related={[{ href: '/guide/rpc', label: 'RPC & routes' }]}
/>
