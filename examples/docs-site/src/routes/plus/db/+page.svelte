<script lang="ts">
import Code from '#lib/Code.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Plus</li>
		<li>Db</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Db (<code class="text-2xl">@swelte/plus</code>)</h1>
<p class="py-4 opacity-80">
	Embedded SQLite/KV — beyond-SvelteKit, optional package. No Neon/PlanetScale: a single SQLite
	file (WAL mode) lives next to the binary. Core stays parity-only; plus owns the
	<code>swelte migrate</code> CLI.
</p>

<div class="mt-2">
	<Code snippet={codeHtml['plus-install']} dense title="install" />
</div>
<div class="mt-2">
	<Code snippet={codeHtml['plus-migrate']} dense title="swelte migrate" />
</div>
<div class="mt-2">
	<Code snippet={codeHtml['plus-db']} dense title="src/lib/backend/db.v" />
</div>
<p class="text-sm opacity-70 mt-2">
	First run scaffolds <code>src/lib/backend/db.v</code> (backend-only, importable from
	<code>#routes/*.v</code>, never from the browser) + <code>db/migrations/001_swelte_kv.sql</code>,
	then applies <code>db/migrations/*.sql</code> in order (tracked in
	<code>_swelte_migrations</code>, idempotent). App tables are your own SQL; the
	<code>swelte_kv</code> table is the primitive SWR regen / outbox build on.
</p>

<h2 class="text-2xl font-bold mt-8">Rooms — cross-request broadcast</h2>
<p class="py-2 opacity-80 text-sm">
	Any verb/<code>@[rpc]</code> publishes with
	<code>backend.emit(room, msg)</code> (returns the delivered count); a room-mode
	<code>@[sse]</code> fn subscribes and streams live hub messages. Single-instance
	best-effort (same tier as cron); backpressure-safe (cap-1 buffer, slow
	subscribers drop, publishers never stall); harness-owned subscriptions
	(auto-reaped on disconnect — return from the fn to leave).
</p>
<div class="mt-2">
	<Code snippet={codeHtml['plus-rooms']} dense title="rooms: emit + room SSE" />
</div>

<h2 class="text-2xl font-bold mt-8">Sockets — first-class `@[ws]` rooms</h2>
<p class="py-2 opacity-80 text-sm">
	One socket fn per file on the same hub:
	<code>backend.emit(room, msg)</code> publishes cross-request, the harness injects
	the <code>sub</code> room-subscribe closure, the inbound <code>recv</code> channel, and
	the <code>emit</code> frame emitter. Echo round-trips client frames; rooms fan out
	hub messages to every subscriber. TS stubs are URL builders — the browser opens a
	native <code>WebSocket</code> itself. Non-upgrade GETs on the same path fall through
	to dispatch.
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

<h2 class="text-2xl font-bold mt-8">Gotcha: exec vs exec_none</h2>
<p class="py-2 opacity-80 text-sm">
	V's <code>db.sqlite</code> <code>exec()</code> only steps row-returning queries — DDL/DML
	(CREATE/INSERT/UPDATE/DELETE) silently no-op through it. Use <code>exec_none()</code> and
	expect <code>101</code> (SQLITE_DONE). SELECTs keep <code>exec()</code> +
	<code>Row.get_string/get_int</code>.
</p>
