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
	per render; prerender and ISR can retain the resulting HTML. Default is SPA/static + JSON; SSR is
	optional.
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
	+ <code>data-swelte-ssr="1"</code>. Default renderer fallback serves the SPA shell. Strict mode
	rejects unexpected fallback with HTTP 500.
</p>

<h2 class="text-2xl font-bold mt-8"><code class="text-lg">@&#91;load&#93</code> cascade</h2>
<div class="mt-2">
	<Code snippet={codeHtml['ssr-load']} dense />
</div>
<p class="text-sm opacity-70 mt-2">
	Root-first threading, one JSON encode at the edge. Throw → the nearest directory
	<code>+error.svelte</code>, with <code>&#123; status?, message? &#125;</code> props. Physical
	ancestry includes route groups; a broken boundary falls back to its parent. See
	<a class="link" href="/guide/errors">error boundaries</a>.
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
	<span class="badge badge-error">no setup-time network calls</span>
	<span class="badge badge-error">no asynchronous setup</span>
	<span class="badge badge-error">no top-level stub calls</span>
</div>
<p class="text-sm opacity-70 mt-2">
	QuickJS is pure-sync; <code>load()</code> stays in V. Browser-only SDK calls become render-time
	throw-stubs; page state uses a request-local SSR shim. Guards inspect executable syntax, ignoring
	prose, literal markup, CSS, comments and string contents. Template interpolation and markup
	expressions are checked; deferred event handlers remain allowed.
</p>
<h2 class="text-2xl font-bold mt-8">State, isolation and strict rendering</h2>
<p class="opacity-80 mt-2">
	SSR renders one nested Svelte tree with per-level load data, context and head output. Page state
	is local to the request. Hydration uses the serialized initial envelope without refetching initial
	data. Set <code>SWELTE_SSR_STRICT=1</code>
	to reject unexpected renderer fallback; load watchdog timeouts return 504. Original QuickJS
	exception details require <code>SWELTE_SSR_DIAGNOSTICS=1</code>; ordinary client responses stay
	sanitized.
</p>
<h2 class="text-2xl font-bold mt-8">Packages and verification</h2>
<p class="opacity-80 mt-2">
	The SSR bundle resolves installed Svelte/TypeScript/runes modules, package-private imports and
	CommonJS dependencies. <code>swelte ssr-check</code> (via
	<code>SWELTE_PLUGINS=@swelte/ssr-qjs</code>) probes the sidecar, Hand backend and embedded
	production binary when their artifacts exist, then shuts down its probe processes.
	<code>swelte dev</code>
	boots the development sidecar automatically when the adapter is installed; production embeds
	QuickJS and needs no Node runtime.
</p>
<p class="opacity-70 mt-2">
	The measurements above describe a small example workload, not a production capacity guarantee. The
	native dogfood measurement harness records startup, memory, streaming latency and concurrency with
	explicit workload limits.
</p>
<DocsNav
	next={{ href: '/guide/cli', label: 'CLI' }}
	related={[{ href: '/guide/config', label: 'Config' }]}
/>
