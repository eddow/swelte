/**
 * Client-side docs search index (static, SSR-safe).
 *
 * No fetch, no WASM, no async — a plain title/keyword table the layout
 * filters locally. Keep in sync with the nav groups in `+route.svelte`.
 */
export interface SearchEntry {
	href: string
	label: string
	group: string
	keywords: string
}

export const searchIndex: SearchEntry[] = [
	{
		href: '/',
		label: 'Overview',
		group: 'Start',
		keywords: 'swelte v svelte rpc wasm binary agents install overview',
	},
	{
		href: '/install',
		label: 'Installation',
		group: 'Start',
		keywords: 'install setup scaffold npm init ssr optional ssr-qjs vvm node probe +page.v',
	},
	{
		href: '/quickstart',
		label: 'Quickstart',
		group: 'Start',
		keywords: 'quickstart route server client greeting save +page.v svelte state fetch',
	},
	{
		href: '/guide/rpc',
		label: 'RPC & routes',
		group: 'Guide',
		keywords:
			'rpc routes .v attributes get post rpc sse load swelteloadresult before after route groups dynamics matchers wrappers +route swelteerror isredirect handlefetch checkupdated updated',
	},
	{
		href: '/guide/types',
		label: 'Types',
		group: 'Guide',
		keywords: 'types projection codegen typescript struct args result params routeid',
	},
	{
		href: '/guide/forms',
		label: 'Forms',
		group: 'Guide',
		keywords: 'forms verbs qualifiers ?q no-js 303 fail isfail deserialize enhance applyaction',
	},
	{
		href: '/guide/errors',
		label: 'Errors',
		group: 'Guide',
		keywords: 'errors envelope swelterpcerror spa-first 404 shell json dispatch',
	},
	{
		href: '/guide/config',
		label: 'Config',
		group: 'Guide',
		keywords:
			'config env svelte.config.js swelte key knobs prerender entries csr layout limits serializedheaders isr offline service worker ssr csp csrf locals cookies head options goto preloaddata preloadcode pushstate replacestate snapshot updated data-sveltekit',
	},
	{
		href: '/guide/offline',
		label: 'Offline',
		group: 'Guide',
		keywords:
			'offline service worker sw.js precache register auto manual cache network api sse fallback',
	},
	{
		href: '/guide/ssr',
		label: 'SSR',
		group: 'Guide',
		keywords:
			'ssr quickjs render load cascade error props budgets guards render.js sidecar preview',
	},
	{
		href: '/guide/cli',
		label: 'CLI',
		group: 'Guide',
		keywords:
			'cli dev build preview test check init export target snapshot contract format json agents',
	},
	{
		href: '/guide/mcp',
		label: 'Agents',
		group: 'Guide',
		keywords:
			'agents mcp skills install model context protocol tools agent ide diagnostics wasm maps overview ssr svelte5 sveltekit delta routes',
	},
	{
		href: '/plus/jobs',
		label: 'Jobs',
		group: 'Plus',
		keywords:
			'plus jobs cron scheduler retry dead-letter tick log scheduled tasks app.v jobsplugin backoff blocking catchup',
	},
	{
		href: '/plus/db',
		label: 'Db',
		group: 'Plus',
		keywords:
			'plus db sqlite migrate kv backend exec_none wal swelte_kv migrations _swelte_migrations embedded database',
	},
	{
		href: '/from-sveltekit',
		label: 'From SvelteKit',
		group: 'Migrate',
		keywords:
			'sveltekit migrate +page +layout server load layout hooks lib matchers streaming stores navigation ssr csr prerender limits snapshot goto preloadcode pushstate serializedheaders handlefetch updated handleerror',
	},
	{
		href: '/versus',
		label: 'Versus',
		group: 'Migrate',
		keywords: 'versus next sveltekit leptos dioxus axum go liveview dotnet enterprise paradigm',
	},
	{
		href: '/example',
		label: 'Example app',
		group: 'Migrate',
		keywords: 'example something demo session admin router tags enhance verbs live error',
	},
]

export function searchDocs(query: string, limit = 8): SearchEntry[] {
	const q = query.trim().toLowerCase()
	if (!q) return []
	const terms = q.split(/\s+/)
	const scored = searchIndex
		.map((e) => {
			const hay = `${e.label} ${e.group} ${e.keywords} ${e.href}`.toLowerCase()
			let score = 0
			for (const t of terms) {
				if (e.label.toLowerCase().includes(t)) score += 3
				else if (hay.includes(t)) score += 1
				else return null
			}
			return { e, score }
		})
		.filter((x): x is { e: SearchEntry; score: number } => x !== null)
		.sort((a, b) => b.score - a.score)
	return scored.slice(0, limit).map((s) => s.e)
}
