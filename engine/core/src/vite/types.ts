/** Shared option + shape types for the swelte vite plugin (no runtime deps).
 *
 *  `SwelteConfig`/`SwelteOptions` live in `../gen/config.js` — import
 *  them from `@swelte/core/config` (or the `vite` barrel), never here. */

export interface SweltePluginOptions {
	compat?: 'none' | 'sveltekit'
	/** Action query syntax: `'named'` (default, `?/save`) or `'legacy'` (`?save` / `?q=save`). */
	actionQuery?: 'legacy' | 'named'
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
	serviceWorker?: {
		enabled?: boolean
		register?: 'auto' | 'manual'
		outbox?: import('./outbox.js').OutboxOptions | null
	}
	/** Prerender/SSG crawl: 'off' (default) | { entries: 'static'|'all'|'off', concurrency }. */
	prerender?: { entries?: 'static' | 'all' | 'off'; concurrency?: number }
	/** Public native HTML cache: path-prefix to TTL seconds. */
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
		| 'shutdown'
		| 'report'
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
	/** Raw V body of a server lifecycle/reporting hook. */
	hookBody?: string
	/** 1-based source line of the `@[...]` attribute in its file. */
	line?: number
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
	imports?: string
	/** Raw V body of `@[startup]` (inlined into main before veb.run). */
	startupBody?: string
	shutdownBody?: string
	reportBody?: string
	reportParam?: string
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

/** One parsed V declaration a plugin claims, with its source context.
 *  `kind` separates route/backend/shared-lib/app origins; `file` is the
 *  project-relative path (`src/app.v`, `src/routes/...`, `src/lib/...`);
 *  `modulePath` is the core mod (`api/rooms`, `backend/db`, `app`);
 *  `line` is the 1-based `@[...]` line in that file (from `RpcFn.line`);
 *  `source` is the full file text and `structs` its parsed `pub struct`s. */
export interface SweltePluginDeclaration {
	kind: 'app' | 'route' | 'backend' | 'lib'
	file: string
	modulePath: string
	line: number
	source: string
	fn: RpcFn
	structs: VStruct[]
}

/** Named generated files a plugin contributes (e.g. CLI helpers, runtime
 *  includes). Core owns the output dir (`.swelte/<plugin.name>/`), validates
 *  ownership, rejects collisions and prunes stale output on regeneration or
 *  plugin removal — even when the app declares no matching attributes. */
export interface SweltePluginGenerateCtx {
	/** Resolved dirs (`src/routes`, `src/lib`, `.swelte`). */
	dirs: { routesDir: string; libDir: string; outDir: string }
	/** Claimed declarations across app/routes/backend/lib (may be empty). */
	declarations: SweltePluginDeclaration[]
	/** Raw `swelte[configKey]` value (absent key = undefined). */
	config: unknown
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
	/** V emitted INSIDE `fn main()` after app startup succeeds. */
	mainInner?: string
	/** V emitted INSIDE the shutdown path (reverse plugin order). */
	shutdown?: string
	beforeRequest?: string
	protect?: string[]
}

/** Outcome of resolving the configured plugins for one generate/CLI run:
 *  deduped registration order (first wins per `name`), per-plugin claimed
 *  declarations, and any resolution failure. Ordering: `plugins` run in
 *  registration order at startup; shutdown fragments emit in reverse. */
export interface SweltePluginResolved {
	plugins: SweltePlugin[]
	claims: Map<string, SweltePluginDeclaration[]>
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
	validate?: (
		rel: string,
		fn: {
			name: string
			attr: string
			qualifier?: string
			params?: { name: string; vtype: string }[]
			vret?: string
		},
		declaration?: SweltePluginDeclaration
	) => void
	/** V fragments appended to the route leaf file (e.g. Plus rooms emits
	 *  the `sse_room` / `swelte_ws_open` accessors for claimed room/WS fns).
	 *  Called per dispatched route file with that file's claimed fns
	 *  (name/attr plus qualifier, params and fallibility for dispatch). */
	emitRoute?: (
		ctx: SweltePluginRouteCtx,
		fns: {
			name: string
			attr: string
			qualifier?: string
			params?: { name: string; vtype: string }[]
			fallible?: boolean
		}[]
	) => string
	/** V fragment appended to server_gen.v (e.g. Plus rooms emits the
	 *  `sse_is_room` / `sse_room_for` / `ws_is` / `ws_open_for` fan-out
	 *  tables routing prefixes to the per-file accessors above). Called
	 *  once with the dispatched routes contributing claimed fns, each
	 *  annotated with its claimed attrs plus precomputed `room` (room-mode
	 *  `sse` present) / `socket` (`ws` present) flags so the plugin fans
	 *  out per capability — a room-only file has no `swelte_ws_open`
	 *  accessor and must not appear in the socket tables. */
	emitServerGen?: (
		routes: { route: string; prefix: string; attrs: string[]; room: boolean; socket: boolean }[]
	) => string
	harness?: (config: unknown, declarations?: SweltePluginDeclaration[]) => SweltePluginHarness
	/** App-level hooks from `src/app.v`: called with the parsed fns carrying
	 *  plugin attrs (e.g. Plus `cron`). The owner parses+validates+emits;
	 *  core passes through. Returns V spliced into the harness
	 *  (e.g. cron spawn loops). */
	loadAppHooks?: (
		root: string,
		srcDir?: string,
		declarations?: SweltePluginDeclaration[]
	) => {
		fragment?: SweltePluginHarness
		errors?: string[]
	}
	/** Named output files owned by this plugin (`.swelte/<name>/...`).
	 *  Runs even when the app declares no matching attributes (CLI helpers,
	 *  runtime includes). Core validates names, rejects collisions across
	 *  plugins/core and prunes stale output on regeneration or removal. */
	generate?: (ctx: SweltePluginGenerateCtx) => Record<string, string>
	/** TS declarations appended to types/<mod>.d.ts (e.g. a plugin could
	 *  document claimed fns; core emits verb/rpc/sse/ws DTS itself). */
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
