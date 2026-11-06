<script lang="ts">
import Code from '#lib/Code.svelte'
import DocsNav from '#lib/DocsNav.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Plus</li>
		<li>Realtime</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Realtime (<code class="text-2xl">@swelte/plus</code>)</h1>
<p class="py-4 opacity-80">
	Rooms + sockets on one hub — beyond-SvelteKit, optional package. Ships inside
	<code>@swelte/plus/db</code>
	(same install, same <code>dbPlugin</code>): the hub is the reason sockets live here and not in
	core. Core stays parity-only; plus owns the
	<code>backend.emit</code>
	hub <code>@[sse]</code> and <code>@[ws]</code> ride.
</p>

<div class="mt-2">
	<Code snippet={codeHtml['plus-install']} dense title="install + dbPlugin" />
</div>

<h2 class="text-2xl font-bold mt-8">Rooms — cross-request broadcast</h2>
<p class="py-2 opacity-80 text-sm">
	Any verb/<code>@[rpc]</code>
	publishes with
	<code>backend.emit(room, msg)</code>
	(returns the delivered count); a room-mode
	<code>@[sse]</code>
	fn subscribes and streams live hub messages. Single-instance best-effort (same tier as cron);
	backpressure-safe (cap-1 buffer, slow subscribers drop, publishers never stall); harness-owned
	subscriptions (auto-reaped on disconnect — return from the fn to leave).
</p>
<div class="mt-2">
	<Code snippet={codeHtml['plus-rooms']} dense title="rooms: emit + room SSE" />
</div>

<h2 class="text-2xl font-bold mt-8">Sockets — first-class `@[ws]` rooms</h2>
<p class="py-2 opacity-80 text-sm">
	One socket fn per file on the same hub:
	<code>backend.emit(room, msg)</code>
	publishes cross-request, the harness injects the <code>sub</code> room-subscribe closure, the
	inbound <code>recv</code> channel, and the <code>emit</code> frame emitter. Echo round-trips
	client frames; rooms fan out hub messages to every subscriber. TS stubs are URL builders — the
	browser opens a native <code>WebSocket</code> itself. Non-upgrade GETs on the same path fall
	through to dispatch.
</p>
<div class="mt-2">
	<Code snippet={codeHtml['plus-sockets-echo']} dense title="echo: recv → emit" />
</div>
<div class="mt-2">
	<Code snippet={codeHtml['plus-sockets-rooms']} dense title="rooms: sub + emit on the hub" />
</div>
<div class="mt-2">
	<Code snippet={codeHtml['plus-sockets-client']} dense title="browser: new WebSocket(url)" />
</div>

<DocsNav
	next={{ href: '/from-sveltekit', label: 'From SvelteKit' }}
	related={[{ href: '/plus/db', label: 'Database' }]}
/>
