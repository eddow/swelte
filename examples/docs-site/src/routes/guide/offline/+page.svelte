<script lang="ts">
import DocsNav from '#lib/DocsNav.svelte'
import Code from '#lib/Code.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Guide</li>
		<li>Offline</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Offline shell & mutation outbox</h1>
<p class="py-4 opacity-80">
	An opt-in service worker caches the shell and immutable assets. Explicit mutations can also use a
	persistent outbox. Disabled by default — no worker or registration is emitted.
</p>

<div class="alert alert-info">
	<span
		>Enable with <code>swelte.serviceWorker.enabled: true</code> in <code>svelte.config.js</code> or
		<code>SWELTE_SW=1</code>
		in the env (env wins). See <code>openspec/specs/configuration/reference.md</code> §Service
		worker + §Offline fallback page.</span
	>
</div>

<h2 class="text-2xl font-bold mt-8">What the build emits</h2>
<ul class="list-disc list-inside opacity-80 space-y-1 mt-2">
	<li>Additive <code>dist/sw.js</code> only — the single-artifact default never changes.</li>
	<li>
		Hand-rolled precache (no workbox dep): <code>/</code> + hashed <code>assets/*.js</code> +
		<code>assets/*.wasm</code>; cache version = <code>version</code> stamp, only this registration’s
		old caches are purged on activate.
	</li>
	<li>
		<code>offline.fallback</code>
		page precached only when configured <em>and</em> the prerender pass wrote it.
	</li>
</ul>

<h2 class="text-2xl font-bold mt-8">Registration</h2>
<ul class="list-disc list-inside opacity-80 space-y-1 mt-2">
	<li><code>register: 'auto'</code> (default) injects a same-origin registration snippet.</li>
	<li>
		<code>register: 'manual'</code>
		emits <code>dist/sw.js</code> but skips the snippet — the app registers itself.
	</li>
</ul>

<h2 class="text-2xl font-bold mt-8">Runtime scope</h2>
<ul class="list-disc list-inside opacity-80 space-y-1 mt-2">
	<li>GET navigations + immutable assets are cache-first with SPA-shell offline fallback.</li>
	<li>
		<code>Accept: application/json</code>
		/ <code>text/event-stream</code> / POST / <code>/api/*</code> are network-only — offline the
		caller sees the failure, never stale JSON.
	</li>
	<li><code>#lib/</code> WASM rides the same immutable-asset cache.</li>
	<li>
		<code>Hand</code>
		serves exact <code>dist/</code> files (incl. <code>sw.js</code>) regardless of Accept — real
		files win over the SPA-first proxy rule.
	</li>
</ul>

<h2 class="text-2xl font-bold mt-8">Persistent mutation outbox</h2>
<div class="mt-2"><Code snippet={codeHtml['outbox-config']} dense title="svelte.config.js" /></div>
<p class="opacity-80 mt-2">
	The allowlist matches whole path prefixes relative to <code>swelte.base</code>, on the worker's
	origin. POST, PUT, PATCH and DELETE are supported. Ordinary failed requests are not automatically
	enqueued; call <code>enqueueOffline</code> from a browser handler after the worker takes control.
</p>
<div class="mt-2"><Code snippet={codeHtml['outbox-client']} dense title="browser handler" /></div>
<p class="opacity-80 mt-2">
	Enqueue resolves after an IndexedDB transaction commits and returns a stable UUID. Every attempt,
	including a manual retry, sends that UUID as <code>Idempotency-Key</code>. The endpoint must
	deduplicate it: a response can be lost after a mutation commits. Delivery is at least once.
</p>
<h2 class="text-2xl font-bold mt-8">Retries and retained failures</h2>
<ul class="list-disc list-inside opacity-80 space-y-2 mt-2">
	<li>
		Requests preserve URL, method, headers and body: up to 1 MiB per request and 1000 records.
	</li>
	<li>
		Replay is sequential. IndexedDB leases prevent overlapping workers from claiming the same
		request; leases expire after 60 seconds and requests time out after 30 seconds.
	</li>
	<li>
		2xx acknowledgements delete records. Network errors, 408, 425, 429 and 5xx retry with
		exponential delays from 1 second to 1 hour. <code>Retry-After</code> can extend the delay up to
		24 hours.
	</li>
	<li>
		Other statuses, redirects, expiry and exhausted attempts retain a <code>failed</code> record.
		Pending retries hold later work; failed records do not block it.
	</li>
	<li>Defaults are five attempts and 24 hours. Bounds are 1–20 attempts and 1 second–30 days.</li>
</ul>
<p class="opacity-80 mt-2">
	Background Sync schedules retries where supported. After its first use, the SDK also flushes on
	<code>online</code>. Call <code>flushOutbox()</code> on app startup or provide a retry control in
	browsers without Background Sync. It returns true while retryable work remains.
</p>
<p class="opacity-80 mt-2">
	<code>listOutbox()</code>
	returns metadata without bodies or headers.
	<code>retryOutbox(id)</code>
	resets the attempt and age budget while preserving the key;
	<code>discardOutbox(id)</code>
	explicitly removes an entry. Worker messages of type
	<code>swelte:outbox:changed</code>
	can trigger a UI refresh. The database survives worker upgrades and restarts, subject to browser
	storage eviction or removal.
</p>
<h2 class="text-2xl font-bold mt-8">Credentials and account changes</h2>
<p class="opacity-80 mt-2">
	Credentials default to <code>omit</code>. Explicit <code>credentials: 'same-origin'</code>
	replays with current cookies; caller-supplied Authorization headers are persisted. Authenticated
	apps must discard queued entries on sign-out or account switches. Swelte does not infer app
	identity.
</p>

<DocsNav
	next={{ href: '/guide/ssr', label: 'SSR' }}
	related={[{ href: '/guide/config', label: 'Config' }]}
/>
