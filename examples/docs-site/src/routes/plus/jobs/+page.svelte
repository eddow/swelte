<script lang="ts">
import Code from '#lib/Code.svelte'
import DocsNav from '#lib/DocsNav.svelte'
import { codeHtml } from '#lib/snippets.gen.js'
</script>

<div class="breadcrumbs text-sm">
	<ul>
		<li><a href="/">Home</a></li>
		<li>Plus</li>
		<li>Jobs</li>
	</ul>
</div>

<h1 class="text-4xl font-bold mt-2">Jobs (<code class="text-2xl">@swelte/plus</code>)</h1>
<p class="py-4 opacity-80">
	Scheduled <code>@[cron]</code> ticks — beyond-SvelteKit, optional package. Core stays parity-only
	(byte-identical output without plugins); plus owns attrs core never names.
</p>

<div class="mt-2">
	<Code snippet={codeHtml['plus-install']} dense title="install" />
</div>
<div class="mt-2">
	<Code snippet={codeHtml['plus-vite-config']} dense title="vite.config.ts" />
</div>
<p class="text-sm opacity-70 mt-2">
	Without the plugin, <code>@[cron]</code> is an unknown-attr build error. With it,
	<code>src/app.v</code>
	may hold one-or-more tick fns; core ignores them everywhere else. No CLI, no SSH — ticks start at
	boot in the container.
</p>

<h2 class="text-2xl font-bold mt-8"><code class="text-lg">@[cron]</code> ticks</h2>
<div class="mt-2">
	<Code snippet={codeHtml['plus-cron']} dense title="src/app.v" />
</div>
<div class="overflow-x-auto mt-6">
	<table class="table table-zebra table-sm">
		<thead>
			<tr>
				<th>Rule</th>
				<th>Detail</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td><code>location</code></td>
				<td><code>src/app.v</code> only (route files → <code>only allowed in src/app.v</code>)</td>
			</tr>
			<tr>
				<td><code>qualifier</code></td>
				<td>
					<code>'&lt;duration&gt;[,retry=n]'</code>
					— duration is digits + <code>s|m|h</code>, nonzero (<code>'60s'</code>, <code>'5m'</code>,
					<code>'1h'</code>); whitespace around the comma tolerated
				</td>
			</tr>
			<tr>
				<td><code>retry</code></td>
				<td>
					<code>retry=1..5</code>, fallible (<code>!void</code>) fns only — <code>void</code> +
					retry is a file+line build error
				</td>
			</tr>
			<tr>
				<td><code>shape</code></td>
				<td>no params, <code>void</code> / <code>!void</code> only; bodies must be idempotent</td>
			</tr>
		</tbody>
	</table>
</div>

<h2 class="text-2xl font-bold mt-8">Console log schema</h2>
<p class="py-2 opacity-80 text-sm">
	All tick outcomes go to the console (stderr) — no log file by design (container-native: collected
	by Railway/docker logs, <code>grep</code>-able). First-try success stays silent.
</p>
<div class="mt-2">
	<Code snippet={codeHtml['plus-console']} dense title="stderr" />
</div>
<div class="overflow-x-auto mt-6">
	<table class="table table-zebra table-sm">
		<thead>
			<tr>
				<th>Status</th>
				<th>When</th>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td><em>(none)</em></td>
				<td>first-try success — silent, zero log spam</td>
			</tr>
			<tr>
				<td><code>retry</code></td>
				<td>attempt failed, sleeping <code>(attempt+1) * 5s</code> then retrying</td>
			</tr>
			<tr>
				<td><code>ok</code></td>
				<td>recovered on <code>attempt=N</code> (only logged when N &gt; 0)</td>
			</tr>
			<tr>
				<td><code>dead</code></td>
				<td>all <code>retry=N</code> attempts failed — dead-letter</td>
			</tr>
			<tr>
				<td><code>error</code></td>
				<td>fallible tick failed, no <code>retry=</code> configured</td>
			</tr>
			<tr>
				<td><code>catchup</code></td>
				<td>scheduler woke behind <code>&gt;= 2 * every</code>, fires once then resumes</td>
			</tr>
		</tbody>
	</table>
</div>

<h2 class="text-2xl font-bold mt-8">How it works</h2>
<ul class="list-disc list-inside opacity-80 space-y-1 mt-2">
	<li>
		<code>loadAppHooks</code>
		reads <code>src/app.v</code>, validates every <code>@[cron]</code> fn, and emits two fragments
		into the V harness (before <code>mut app := &amp;App&#123;&#125;</code>).
	</li>
	<li>
		<code>main</code>: top-level <code>swelte_cron_N</code> fns (user bodies verbatim, so fallible
		fns compile) + <code>swelte_cron_run()</code> — the ONE scheduler thread.
	</li>
	<li>
		<code>mainInner</code>: <code>// @[cron]</code> header + <code>spawn swelte_cron_run()</code>.
	</li>
	<li>
		The scheduler holds a <code>next[i]</code> unix deadline per tick, sleeps to the nearest one
		(idle = one sleeping thread, zero wakeups/CPU), fires due ticks, and advances
		<code>next[i] = now + every</code>. Missed ticks coalesce, never a catch-up burst.
	</li>
	<li>
		Retries run a <strong>blocking</strong> linear-backoff loop inside the tick's arm — the
		scheduler thread is preserved, but a retrying tick may briefly delay other ticks (cap 5 bounds
		this to ~75s worst case).
	</li>
	<li>Zero ticks → empty fragments: harness byte-identical to parity output.</li>
</ul>

<h2 class="text-2xl font-bold mt-8">Limits (by design)</h2>
<ul class="list-disc list-inside opacity-80 space-y-1 mt-2">
	<li>Single-instance best-effort: two containers = two schedulers (no distributed lock).</li>
	<li>No persistence yet: tick log is console-only; cross-restart catchup is future work.</li>
	<li>No cron-expression parser in v1 — duration literal only.</li>
</ul>
<DocsNav next={{ href: '/plus/db', label: 'Database' }} related={[{ href: '/guide/mcp', label: 'Agents' }]} />
