<script lang="ts">
import Code from '#lib/Code.svelte'
import DocsNav from '#lib/DocsNav.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>SSR</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">SSR</h1>
<p class="py-4 opacity-80">
	One <code>render.js</code> per app, all routes inside. Data comes from <code>@&#91;load&#93</code>
	per request — never baked in. Default is SPA/static + JSON; SSR is runtime-only and measured.
</p>

<div class="alert alert-info mt-2">
	<span
		>SSR is optional — <code>@swelte/ssr-qjs</code> is a separate install (<code
			>npm install @swelte/ssr-qjs</code
		>). Without it, <code>swelte build</code> skips the bridge pass and serves the static/SPA shell.
		<code>import &#40;swelte&#41; from '@swelte/ssr-qjs'</code>
		in <code>vite.config.ts</code> only works once the package is installed.</span
	>
</div>

<ul class="steps w-full my-2">
	<li class="step step-primary">HTML nav</li>
	<li class="step step-primary">load cascade</li>
	<li class="step step-primary">QuickJS render</li>
	<li class="step">hydrate</li>
</ul>

<h2 class="text-2xl font-bold mt-6">Request path</h2>
<p class="opacity-80 text-sm mt-2">
	Browser <code>GET /</code> → <code>Hand.before_request</code> → <code>swelte_page_props()</code>
	(load cascade) → embedded QuickJS <code>renderRoute(path, props)</code> → HTML at
	<code>&lt;!--ssr-body--&gt;</code>
	+ <code>data-swelte-ssr="1"</code>. Failures fall back to the SPA shell — never blank JSON for
	navigations.
</p>

<h2 class="text-2xl font-bold mt-8"><code class="text-lg">@&#91;load&#93</code> cascade</h2>
<div class="mt-2">
	<Code snippet={codeHtml['ssr-load']} dense />
</div>
<p class="text-sm opacity-70 mt-2">
	Root-first threading, one JSON encode at the edge. Throw → <code>+error</code> props (single
	global <code>+error.svelte</code>, <code>&#123; status?, message? &#125;</code>).
</p>

<h2 class="text-2xl font-bold mt-8">Measured budgets</h2>
<div class="stats shadow w-full">
	<div class="stat">
		<div class="stat-title">Render</div>
		<div class="stat-value text-2xl">~0.012ms</div>
		<div class="stat-desc">200 renders in 2.4ms, in-process</div>
	</div>
	<div class="stat">
		<div class="stat-title">End-to-end</div>
		<div class="stat-value text-2xl">~3–12ms</div>
		<div class="stat-desc">browser GET / against dist/server</div>
	</div>
	<div class="stat">
		<div class="stat-title">Binary delta</div>
		<div class="stat-value text-2xl">+~1MB</div>
		<div class="stat-desc">vendored QuickJS + glue (5.1 → 6.1MB)</div>
	</div>
</div>

<h2 class="text-2xl font-bold mt-8">SSR guards (build errors)</h2>
<div class="flex gap-2 flex-wrap mt-2">
	<span class="badge badge-error">no node: imports</span>
	<span class="badge badge-error">no fetch(</span>
	<span class="badge badge-error">no top-level pause</span>
	<span class="badge badge-error">no top-level stub calls</span>
</div>
<p class="text-sm opacity-70 mt-2">
	QuickJS is pure-sync; <code>load()</code> stays in V. Known SDK imports become render-time
	throw-stubs.
</p>
<DocsNav next={{ href: '/guide/cli', label: 'CLI' }} related={[{ href: '/guide/config', label: 'Config' }]} />
