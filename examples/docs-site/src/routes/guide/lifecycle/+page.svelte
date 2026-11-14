<script lang="ts">
import DocsNav from '#lib/DocsNav.svelte'
</script>
<h1 class="text-4xl font-bold mt-2">Page lifecycle</h1>
<p class="py-4 opacity-80">HTML rendering, navigation and refresh share a guarded V load cascade.
Middleware runs before handlers, loads, actions, streams and socket takeover.</p>
<h2 class="text-2xl font-bold mt-8">Loads and component data</h2>
<p class="opacity-80 mt-2">Root-first loads retain each wrapper's data. Default mode uses flat
props. With <code>swelte.compat: 'sveltekit'</code>, ancestor objects merge into each level's
<code>data</code>, deeper keys win, and components receive data/form props.
Synchronous universal loads transform data in SSR and the browser; native I/O stays in V.</p>
<h2 class="text-2xl font-bold mt-8">SSR and hydration</h2>
<p class="opacity-80 mt-2">Each render gets isolated page state. A single Svelte tree preserves
wrapper context and head output. Public initial state is escaped into an inert JSON element;
locals and secrets are excluded. Hydration reuses that envelope and the same level props.
The canonical reactive object is <code>#app/state</code>; compatibility mode exposes it
through <code>$app/state</code>. Legacy stores remain available.</p>
<h2 class="text-2xl font-bold mt-8">Navigation and refresh</h2>
<p class="opacity-80 mt-2">Navigation loads before committing UI and preserves query strings,
hashes and history. Redirects and errors are explicit outcomes. Stale results cannot replace
a newer navigation. <code>invalidateAll()</code> awaits a load refresh and committed props;
tagged invalidation refreshes affected active loads. Refresh preserves mounted component
state when route and wrapper identities remain unchanged.</p>
<h2 class="text-2xl font-bold mt-8">Native lifecycle and reporting</h2>
<p class="opacity-80 mt-2">Startup hooks finish before dependent plugin jobs begin.
Signal shutdown stops admission, drains loads/jobs/streams and runs bounded cleanup.
Optional report hooks receive request identifiers and server-side lifecycle/error events;
reporter failures are isolated from responses.</p>
<h2 class="text-2xl font-bold mt-8">Prerendering and limits</h2>
<p class="opacity-80 mt-2">Prerendering supports grouped/dynamic entries, encoded parameters,
inherited opt-outs and canonical/head output. Redirects, error pages and fallback shells
are excluded. Hydrated state uses the hosting URL. SSR has one global error component;
per-directory error inheritance remains future work. Background ISR regeneration,
a native image pipeline, an offline outbox and durable scheduled jobs are also future work.</p>
<DocsNav next={{ href: '/guide/forms', label: 'Forms' }} related={[{ href: '/guide/ssr', label: 'SSR' }]} />
