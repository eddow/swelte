<script lang="ts">
import Code from '#lib/Code.svelte'
import DocsNav from '#lib/DocsNav.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Plus</li>
		<li>Database</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">
	Database
	<span class="text-sm font-normal opacity-60"
		>(Plus <code>db</code> plugin — explicit registration)</span
	>
</h1>
<p class="py-4 opacity-80">
	Embedded SQLite/KV — the Plus <code>db</code> plugin. A single SQLite
	file (WAL mode) lives next to the binary;
	<code>swelte migrate</code>
	is a Plus command (resolved from
	<code>swelte(&#123; plugins: [dbPlugin] &#125;)</code>).
</p>

<div class="alert alert-info text-sm">
	<span
		>Rooms + sockets on the hub transport — register the Plus
		<code>db</code> plugin (<code>swelte(&#123; plugins: [dbPlugin] &#125;)</code>). The
		<code>backend.emit</code>
		hub rides that plugin entry; core keeps only the HTTP/SSE/WebSocket transport primitives.</span
	>
</div>

<div class="mt-2">
	<Code snippet={codeHtml['plus-install']} dense title="npm install @swelte/plus" />
</div>
<div class="mt-2">
	<Code snippet={codeHtml['plus-migrate']} dense title="swelte migrate (Plus db plugin)" />
</div>
<div class="mt-2">
	<Code snippet={codeHtml['plus-db']} dense title="src/lib/backend/db.v" />
</div>
<p class="text-sm opacity-70 mt-2">
	First run scaffolds <code>src/lib/backend/db.v</code> (backend-only, importable from
	<code>#routes/*.v</code>, never from the browser) + <code>db/migrations/001_swelte_kv.sql</code>,
	then applies <code>db/migrations/*.sql</code> in order (tracked in
	<code>_swelte_migrations</code>, idempotent). App tables are your own SQL; the
	<code>swelte_kv</code>
	table is available for app-owned key/value data. ISR owns its HTML cache; the browser outbox uses
	IndexedDB. Durable jobs use a separate scheduler SQLite file.
</p>

<h2 class="text-2xl font-bold mt-8">Gotcha: exec vs exec_none</h2>
<p class="py-2 opacity-80 text-sm">
	V's <code>db.sqlite</code> <code>exec()</code> only steps row-returning queries — DDL/DML
	(CREATE/INSERT/UPDATE/DELETE) silently no-op through it. Use <code>exec_none()</code> and expect
	<code>101</code>
	(SQLITE_DONE). SELECTs keep <code>exec()</code> +
	<code>Row.get_string/get_int</code>.
</p>

<h2 class="text-2xl font-bold mt-8">PostgreSQL through V</h2>
<p class="opacity-80 mt-2">
	Plus's <code>db</code> plugin provides embedded SQLite/KV. V also supplies
	<code>db.pg</code>, ORM support, pooling, parameterized queries and transactions. Use those
	facilities from native backend modules with the required libpq dependencies. Initialize shared
	resources during startup and close them after shutdown draining. The disposable PostgreSQL fixture
	probes transaction, migration, locking and failure cleanup; application schemas and migration
	policy remain application-owned.
</p>
<DocsNav
	next={{ href: '/plus/realtime', label: 'Realtime' }}
	related={[{ href: '/plus/jobs', label: 'Jobs' }]}
/>
