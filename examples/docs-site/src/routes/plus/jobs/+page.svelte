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

<h1 class="text-4xl font-bold mt-2">
	Jobs
	<span class="text-sm font-normal opacity-60"
		>(Plus plugin — <code>swelte(&#123; plugins: [jobsPlugin] &#125;)</code>)</span
	>
</h1>
<p class="py-4 opacity-80">
	Scheduled <code>@[cron]</code> ticks — the <code>@swelte/plus</code> jobs plugin, no
	<code>@[cron]</code>
	emission without the <code>plugins:</code> entry. Zero ticks or no plugin emit empty harness
	fragments (byte-identical).
</p>

<div class="mt-2">
	<Code snippet={codeHtml['plus-install']} dense title="install the Plus plugin" />
</div>
<div class="mt-2">
	<Code snippet={codeHtml['plus-vite-config']} dense title="vite.config.ts (Plus plugin entries)" />
</div>
<p class="text-sm opacity-70 mt-2">
	<code>src/app.v</code>
	may hold one-or-more tick fns; route files reject them. No CLI, no SSH — ticks start at boot in
	the container.
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

<h2 class="text-2xl font-bold mt-8">Default process-local scheduling</h2>
<ul class="list-disc list-inside opacity-80 space-y-1 mt-2">
	<li>
		<code>loadAppHooks</code>
		(Plus `jobs` plugin) reads <code>src/app.v</code>, validates every <code>@[cron]</code> fn, and
		emits two fragments into the V harness. Jobs start after app startup succeeds and remain
		lifecycle-tracked.
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

<h2 class="text-2xl font-bold mt-8">Durable schedules</h2>
<div class="mt-2"><Code snippet={codeHtml['plus-durable']} dense title="vite.config.ts" /></div>
<p class="opacity-80 mt-2">
	The factory keeps the same <code>@[cron]</code> functions while persisting their schedules in
	SQLite. <code>SWELTE_JOBS_PATH</code> selects a dedicated file (default
	<code>data/jobs.db</code>), independent of the embedded backend database and app data. SQLite
	development files are needed at build time.
</p>
<p class="opacity-80 mt-2">
	A function name is its persistent identity. First registration schedules it one interval ahead;
	workers poll once a second. An exclusive SQLite transaction spans each due job and its retries,
	serializing cooperating processes. Completion commits <code>next_run</code>, <code>last_run</code>
	and <code>last_status</code> (<code>ok</code>
	or <code>failed</code>) to <code>swelte_jobs</code>. Overdue intervals coalesce into one run after
	restart.
</p>
<p class="opacity-80 mt-2">
	Process death releases the lock and rolls back the deadline, making the run due again. External
	side effects can commit before a crash, so bodies must be idempotent. Execution is at least once;
	a crash restarts the retry policy. A long body or backoff holds the scheduler database writer lock
	and delays its other jobs. Jobs must not access that scheduler database themselves.
</p>
<ul class="list-disc list-inside opacity-80 space-y-2 mt-2">
	<li>
		All cooperating processes must share the same SQLite file, job names and intervals on a
		local/shared-host filesystem. Independent files or network filesystems do not provide this
		coordination.
	</li>
	<li>
		Renaming a function creates a new schedule. Interval changes apply after its next run. Removed
		functions are not executed, even if their rows remain.
	</li>
	<li>Shutdown stops scheduling and releases the connection/transaction as tracked work exits.</li>
	<li>
		Default <code>jobsPlugin</code> (plain, non-durable Plus registration) remains process-local
		best effort: two containers run two schedulers.
	</li>
	<li>Duration qualifiers are supported; cron expressions are not parsed.</li>
</ul>

<DocsNav
	next={{ href: '/plus/db', label: 'Database' }}
	related={[{ href: '/guide/mcp', label: 'Agents' }]}
/>
