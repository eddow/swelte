<script lang="ts">
import Code from '#lib/Code.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>Config</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Config + env</h1>
<p class="py-4 opacity-80">
	Single rule everywhere:
	<strong
		>env wins when set; config is the fallback; unset/invalid/zero/negative means built-in
		default.</strong
	>
</p>

<h2 class="text-2xl font-bold">
	<code class="text-lg">svelte.config.js</code>
	(<code class="text-lg">swelte</code>
	key)
</h2>
<div class="mt-2">
	<Code snippet={codeHtml['config-js']} dense title="svelte.config.js" />
</div>
<p class="text-sm opacity-70 mt-2">
	<code>defineConfig</code>
	keeps <code>swelte</code> non-enumerable: invisible to <code>svelte()</code>, readable by
	<code>loadConfig</code>.
</p>

<h2 class="text-2xl font-bold mt-8">Knobs</h2>
<div class="grid md:grid-cols-2 gap-4 mt-2">
	<div class="card bg-base-100 border border-base-200">
		<div class="card-body">
			<h3 class="card-title text-base">Rendering</h3>
			<ul class="text-sm opacity-80 list-disc list-inside space-y-1">
				<li>
					<code>prerender.entries: off | static | all</code>
					+ sibling <code>entries.ts</code> → additive <code>dist/*.html</code>
				</li>
				<li>
					<code>isr: &#123; '/blog': 60 &#125;</code>
					→ <code>Cache-Control s-maxage</code> + <code>X-Swelte-Revalidate</code>
				</li>
				<li>
					<code>offline.fallback</code>
					— opt-in service worker + precache (<a class="link" href="/guide/offline">offline guide</a
					>)
				</li>
				<li>per-route <code>ssr = false</code> — SPA shell, async universal load client-side</li>
			</ul>
		</div>
	</div>
	<div class="card bg-base-100 border border-base-200">
		<div class="card-body">
			<h3 class="card-title text-base">Lifecycle</h3>
			<ul class="text-sm opacity-80 list-disc list-inside space-y-1">
				<li>
					<code>src/app.v</code>: <code>@&#91;startup]</code> (boot once),
					<code>@&#91;reroute]</code>
					(rewrite first), <code>@&#91;cron('60s')]</code> ticks
				</li>
				<li><code>locals map[string]string</code> threaded through dispatch + cookie helpers</li>
				<li>
					<code>HEAD</code>
					auto-handled on GET arms; <code>OPTIONS</code> is CORS-preflight-only
				</li>
			</ul>
		</div>
	</div>
</div>

<div class="overflow-x-auto mt-6">
	<table class="table table-zebra table-sm">
		<thead>
			<tr>
				<th>Env</th>
				<th>Effect</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td><code>PORT</code></td>
				<td>V backend port (wins over config)</td>
			</tr>
			<tr>
				<td><code>SWELTE_CORS_ORIGIN</code></td>
				<td>CORS allowlist</td>
			</tr>
			<tr>
				<td><code>SWELTE_SSR / SWELTE_SSR_URL</code></td>
				<td>embedded QuickJS / dev sidecar renderer</td>
			</tr>
			<tr>
				<td><code>SWELTE_BODY_LIMIT / RATE_LIMIT / HANDLER_TIMEOUT_MS</code></td>
				<td>request hardening</td>
			</tr>
			<tr>
				<td><code>SWELTE_CSRF_CHECK_ORIGIN / METHOD_OVERRIDE</code></td>
				<td>CSRF gate / <code>?_method=</code></td>
			</tr>
			<tr>
				<td><code>SWELTE_VERSION / SWELTE_ISR / SWELTE_SW</code></td>
				<td>version stamp / ISR map / force service worker</td>
			</tr>
		</tbody>
	</table>
</div>
