/** Shared option + shape types for the swelte vite plugin (no runtime deps).
 *
 *  `SwelteConfig`/`SwelteOptions` live in `../gen/config.js` — import
 *  them from `@swelte/core/config` (or the `vite` barrel), never here. */

export interface SweltePluginOptions {
	routesDir?: string
	libDir?: string
	outDir?: string
	/** V backend base URL for dev RPC proxy (e.g. http://localhost:8131).
	 * Falls back to SWELTE_V_BACKEND_URL (injected by `swelte dev`). Unset = no proxy. */
	vBackendUrl?: string
	/** V+TS plugins (contracted in core, implemented outside it).
	 * Default [] = parity-only output, byte-identical to today. */
	plugins?: SweltePlugin[]
	/** URL trailing-slash policy ('always'|'never'|'ignore'). Env SWELTE_TRAILING_SLASH wins. */
	trailingSlash?: 'always' | 'never' | 'ignore'
	/** Base path for generated URLs (SvelteKit `paths.base` equivalent). */
	base?: string
	/** Assets prefix (SvelteKit `paths.assets` equivalent). Defaults to base. */
	assets?: string
	/** Content-Security-Policy value; injected as a meta tag. Env SWELTE_CSP wins. */
	csp?: string
	/** CSRF origin check: 'ignore' (default) or 'enforce'. Env SWELTE_CSRF_CHECK_ORIGIN wins. */
	csrf?: 'ignore' | 'enforce'
	/** Honor `?_method=` override before verb dispatch. Env SWELTE_METHOD_OVERRIDE wins. */
	methodOverride?: boolean
	/** App version stamp. Defaults to package.json version. Env SWELTE_VERSION wins. */
	version?: string
	/** Opt-in service worker. Default off. Env SWELTE_SW=1 forces on. */
	serviceWorker?: { enabled?: boolean; register?: 'auto' | 'manual' }
	/** Prerender/SSG crawl: 'off' (default) | { entries: 'static'|'all'|'off', concurrency }. */
	prerender?: { entries?: 'static' | 'all' | 'off'; concurrency?: number }
	/** ISR lite: path-prefix to seconds, stamp Cache-Control headers. */
	isr?: Record<string, number>
	/** Offline fallback page: 'off' (default) | 'offline.html' | custom path. */
	offline?: { fallback?: boolean | string }
	/** Deploy target shim (packaging only): 'auto' (default) | 'static' | 'node' | 'edge'. */
	target?: 'auto' | 'static' | 'node' | 'edge'
	/** Client code-splitting. Env `SWELTE_CHUNKING` wins. */
	chunking?: 'single' | 'layout' | 'route'
	/** Cross-build OS passthrough (`swelte build --target-os` fallback).
	 *  Accepted but unused by generate/vite: the `v -o -os` link is
	 *  build.ts-owned (WASM always `-os browser`). Present so inline
	 *  plugin options never leak an "unknown option" warning. */
	targetOs?: string
	/** Cross-build arch passthrough (`swelte build --target-arch` fallback).
	 *  Same contract as targetOs: the `v -o -arch` link is build.ts-owned. */
	targetArch?: string
}

export interface RpcParam {
	name: string
	vtype: string
	tstype: string
	optional: boolean
}

/** Per-route request limits (`export const limits = {...}` in the sibling
 * `.ts`: leaf wins, else nearest explicit wrapper, else null = global env
 * defaults). All fields optional positive ints. */
export interface RouteLimits {
	rate?: number
	rateWindowMs?: number
	timeoutMs?: number
	bodyLimit?: number
}

export interface RpcFn {
	name: string
	attr:
		| 'get'
		| 'post'
		| 'rpc'
		| 'put'
		| 'delete'
		| 'patch'
		| 'sse'
		| 'ws'
		| 'before'
		| 'after'
		| 'load'
		| 'matcher'
		| 'startup'
		| 'reroute'
		| 'error'
		| (string & {})
	qualifier?: string
	params: RpcParam[]
	vret: string
	tsret: string
	fallible: boolean
	singleArgsStruct?: string
	/** Raw V body of a `@[matcher]` fn (transpiled to JS for the router). */
	body?: string
	/** Raw V body of a `@[reroute]`/`@[startup]` hook (inlined into hooks). */
	hookBody?: string
}

/** A `@[load]` page-data loader with its source file for error messages. */
export interface LoadFn extends RpcFn {
	mod: string
	file: string
}

export interface SvelteRouteEntry {
	route: string
	svelte: string
	kind: 'page' | 'plain' | 'error' | 'wrapper'
	hasData: boolean
	/** Layout composition (`export const layout` in the sibling `.ts`, leaf
	 * wins, else nearest explicit wrapper): `false` = bare (no wrappers),
	 * `true` = explicit full chain, `'dir'` = keep wrappers at-or-above that
	 * ancestor dir. `null` = inherit (absent everywhere = full chain, the
	 * only historical behavior). */
	layout: false | true | string | null
	/** Per-route csr flag: `export const csr = false` in the sibling `.ts`
	 * renders SSR HTML only (no client mount/hydrate for that leaf).
	 * Default `true`. */
	csr: boolean
	/** Per-route request limits (`export const limits = {...}` in the
	 * sibling `.ts`, leaf wins, else nearest explicit wrapper, else null
	 * = global env defaults). Enforced by Hand in `before_request`. */
	limits: RouteLimits | null
	/** Sibling universal load (`<basename>.ts` next to the `.svelte`,
	 * e.g. `admin.ts` for `admin.svelte`, `+page.ts` for `+page.svelte`).
	 * `'sync'` = SSR-applied in renderRoute; `'async'` = client-only
	 * (`export const ssr = false`); `false` = no sibling load. Core reads
	 * only the `export const ssr` marker (regex, no engine deps) — ssr-qjs
	 * owns the sync-subset validation. */
	hasUniversalLoad: 'sync' | 'async' | false
	/** Per-route SSR flag for Hand: `export const ssr = false` in the
	 * sibling `.ts` (or wrapper `.ts`) opts the route out — Hand serves
	 * the SPA shell (§4 ssr=false-lite). Absent = SSR on. */
	ssr: boolean
	/** Per-route chunk hint: `export const chunk = 'eager' | 'lazy'` in the
	 * sibling `.ts` (leaf or `+route.ts` wrapper). `'eager'` pins the file
	 * into the parent chunk; `'lazy'` forces its own `import()` chunk.
	 * Default `'inherit'` = follow the global `chunking` mode. */
	chunk: 'eager' | 'lazy' | 'inherit'
	/** Per-page prerender flag: `export const prerender = true | false | 'auto'`
	 * in the sibling `.ts` (leaf or `+route.ts` wrapper). Leaf wins over the
	 * nearest explicit wrapper; both win over the global `prerender.entries`.
	 * `'auto'` = include in the crawl + keep dynamic dispatch. */
	prerender: 'prerender-true' | 'prerender-false' | 'prerender-auto' | 'inherit'
	/** Per-route serialized-headers allowlist (SvelteKit
	 * `filterSerializedResponseHeaders` lite): `export const
	 * serializedHeaders = [...]` in the sibling `.ts`. Null = absent
	 * (no filter). Leaf wins, else nearest explicit wrapper. */
	serializedHeaders: string[] | null
}

export interface PrerenderCrawl {
	mode: 'off' | 'static' | 'all'
	routes: string[]
	/** Dynamics that need sibling `entries` expansion (`entries: 'all'`). */
	dynamics: string[]
	/** Resolved dynamic URLs (only when `mode: 'all'`). */
	expanded: string[]
}

export interface VStruct {
	name: string
	fields: { name: string; vtype: string; tstype: string; optional: boolean }[]
}

export interface MatcherDef {
	name: string
	/** V source (verbatim body lines, module/import stripped at emit). */
	vBody: string
	/** JS function body (transpiled portable subset). */
	jsBody: string
}

export interface ServerHooks {
	/** Raw V body of `@[startup]` (inlined into main before veb.run). */
	startupBody?: string
	/** Raw V body of `@[reroute]` (inlined into before_request). */
	rerouteBody?: string
	/** Raw V body of `@[error]` (SvelteKit `handleError` lite): called
	 * with the throw's message + status before the `+error` mapping;
	 * return '' to keep the message, or a sanitized replacement
	 * (never leak internals to the client). Zero/one fn, no qualifier. */
	errorBody?: string
	hasFile: boolean
}

export interface WrapperMw {
	wmod: string
	src: string
	mws: { name: string; attr: 'before' | 'after' }[]
}

/** One V module dir contributed by a plugin: copied into the `.swelte/`
 *  compilation unit so routes/harness can `import <module>`. The plugin
 *  resolves its own package root (via createRequire self-reference) and
 *  returns ABSOLUTE dirs; core copies `*.v` at generate(). Missing dirs
 *  are skipped (plugin ships TS-only in that install). */
export interface SweltePluginInclude {
	module: string
	absDir: string
}

/** V+TS plugin contract (consumed by core, implemented by plugin packages).
 * Core stays standalone: an app using only parity features (verbs/rpc/sse
 * per-request, serviceWorker/prerender/isr/offline literal)
 * installs no plugin package. Plugins extend via these hooks only.
 * `attr` stays core `RpcFn['attr']`-shaped; unknown attrs claimed by a plugin. */
export interface SweltePluginRouteCtx {
	prefix: string
	mod: string
	route: string
}

export interface SweltePluginHarness {
	imports?: string
	appFields?: string
	/** V emitted BEFORE `fn main()` (top-level fns/types). */
	main?: string
	/** V emitted INSIDE `fn main()` (spawns, startup stmts). Spliced
	 *  right after `mut app := &App{}` so ordering matches user hooks. */
	mainInner?: string
	beforeRequest?: string
	protect?: string[]
}

export interface SweltePlugin {
	name: string
	/** Attrs this plugin claims (e.g. `['cron']`). */
	attrs: string[]
	configKey?: string
	/** V module dirs contributed to the `.swelte/` compilation unit
	 *  (e.g. db → `[{ module: 'backend', absDir: '<pkg>/vlib/backend' }]`).
	 *  Core copies each dir's `*.v` into `.swelte/<module>/` at generate();
	 *  routes/harness then `import <module>`. Missing dirs are skipped.
	 *  Zero-arg: the plugin resolves its own package root internally
	 *  (createRequire self-reference works from src and dist). */
	includes?: () => SweltePluginInclude[]
	validate?: (rel: string, fn: { name: string; attr: string; qualifier?: string }) => void
	/** V fragment appended to the route leaf file. */
	emitRoute?: (ctx: SweltePluginRouteCtx, fns: { name: string; attr: string }[]) => string
	/** V fragment appended to server_gen.v. */
	emitServerGen?: (routes: { route: string; prefix: string }[]) => string
	harness?: (config: unknown) => SweltePluginHarness
	/** App-level hooks from `src/app.v`: called with the parsed fns carrying
	 * this plugin's attrs. Returns V spliced into the harness (e.g. cron
	 * spawn loops). Core passes through; the plugin owns parse+validate+emit. */
	loadAppHooks?: (
		root: string,
		srcDir?: string
	) => {
		fragment?: SweltePluginHarness
		errors?: string[]
	}
	/** TS declarations appended to types/<mod>.d.ts. */
	clientDts?: (mod: string, fns: { name: string; attr: string }[]) => string
	/** CLI commands merged into `swelte` (see `commands/types.ts` Command). */
	cli?: {
		name: string
		summary: string
		args?: { name: string; short?: string; help: string; value?: 'string' | 'number' | 'boolean' }[]
		run: (ctx: {
			argv: string[]
			opts: Record<string, string | number | boolean>
			rest: string[]
			log: (m: string) => void
			error: (m: string) => void
		}) => Promise<void> | void
	}[]
}

export function defineSweltePlugin(plugin: SweltePlugin): SweltePlugin {
	if (!plugin.name) throw new Error('[swelte] plugin needs a name')
	// Attr-claiming plugins (`jobs` → cron) list names here; augment-only
	// plugins leave attrs empty and extend core via harness/CLI/DTS
	// fragments. Empty is valid.
	return plugin
}
