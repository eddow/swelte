// §1 plugin resolution: ordered registration, claimed-declaration fan-out
// and named-file ownership. Core owns discovery/source parsing/staging.
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeIfChanged } from './fs.js'
import { parseStructs, parseVFile } from './parse.js'
import type { RpcFn, SweltePlugin, SweltePluginDeclaration } from './types.js'

/** Plugin names double as `.swelte/<name>/` output dirs and CLI owners.
 *  Single safe segment only (no slashes, dots, or escapes) — anything else
 *  is rejected before any output or cleanup operation touches the disk. */
const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export function assertPluginName(name: unknown): string {
	if (typeof name !== 'string' || !PLUGIN_NAME_RE.test(name))
		throw new Error(
			`[swelte] plugin needs a safe name (single path segment: letters, digits, '-' or '_') — got ${JSON.stringify(name)}`
		)
	return name
}

/** First registration wins (by plugin `name`). Shared by `generate()` and
 *  the CLI so dev/check/build/commands resolve identically.
 *  Malformed entries (missing/unsafe names) throw — never silently drop. */
/** Validate a plugin `cli` entry without running it: every command needs
 *  a name, a summary and a `run` fn. Shared by `resolveCommands` and
 *  `swelte check` (validate-only, no side effects). Lives here (not cli.ts)
 *  so `gen/diagnostics.ts` can import it without a cli<->diagnostics cycle. */
export function assertPluginCli(
	name: string,
	cli: unknown
): asserts cli is { name: string; summary: string; run: (ctx: never) => unknown }[] {
	if (!Array.isArray(cli)) throw new Error(`[swelte] plugin ${name}: cli must be an array`)
	for (const cmd of cli) {
		if (!cmd || typeof cmd !== 'object')
			throw new Error(`[swelte] plugin ${name}: cli entries must be command objects`)
		const c = cmd as { name?: unknown; summary?: unknown; run?: unknown }
		if (typeof c.name !== 'string' || !c.name)
			throw new Error(`[swelte] plugin ${name}: cli command needs a name`)
		if (typeof c.summary !== 'string' || !c.summary)
			throw new Error(`[swelte] plugin ${name}: cli command '${c.name}' needs a summary`)
		if (typeof c.run !== 'function')
			throw new Error(`[swelte] plugin ${name}: cli command '${c.name}' needs a run fn`)
	}
}

export function dedupPlugins(all: SweltePlugin[]): SweltePlugin[] {
	const seen = new Set<string>()
	const out: SweltePlugin[] = []
	for (const pl of all) {
		if (!pl || typeof pl !== 'object') throw new Error('[swelte] plugin entry must be an object')
		assertPluginName((pl as SweltePlugin).name)
		if (seen.has(pl.name)) continue
		seen.add(pl.name)
		out.push(pl)
	}
	return out
}

/** Attribute → owning plugin (first claim wins). */
export function pluginAttrOwners(plugins: SweltePlugin[]): Map<string, SweltePlugin> {
	const out = new Map<string, SweltePlugin>()
	for (const plugin of plugins)
		for (const attr of plugin.attrs ?? []) if (!out.has(attr)) out.set(attr, plugin)
	return out
}

/** Fan claimed declarations out to their owning plugins. Covers
 *  `src/app.v`, routes and backend/shared library files; keeps the raw
 *  source, parsed structs, module path and 1-based line per declaration. */
export function collectPluginDeclarations(
	plugins: SweltePlugin[],
	sources: {
		app: { file: string; modulePath: string; source: string } | null
		routes: { file: string; modulePath: string; source: string }[]
		libs: { kind: 'backend' | 'lib'; file: string; modulePath: string; source: string }[]
	},
	parse: (source: string, extraAttrs: string[]) => RpcFn[] = parseVFile,
	structsOf: (source: string) => SweltePluginDeclaration['structs'] = parseStructs
): Map<string, SweltePluginDeclaration[]> {
	const byAttr = pluginAttrOwners(plugins)
	const out = new Map<string, SweltePluginDeclaration[]>()
	const scan = (
		kind: SweltePluginDeclaration['kind'],
		file: string,
		modulePath: string,
		source: string
	) => {
		const structs = structsOf(source)
		for (const fn of parse(source, [...byAttr.keys()])) {
			const owner = byAttr.get(fn.attr)
			if (!owner) continue
			const list = out.get(owner.name) ?? []
			list.push({ kind, file, modulePath, line: fn.line ?? 1, source, fn, structs })
			out.set(owner.name, list)
		}
	}
	if (sources.app) scan('app', sources.app.file, sources.app.modulePath, sources.app.source)
	for (const route of sources.routes) scan('route', route.file, route.modulePath, route.source)
	for (const lib of sources.libs) scan(lib.kind, lib.file, lib.modulePath, lib.source)
	return out
}

/** Emit `plugin.generate()` outputs under `.swelte/<name>/`. Validates file
 *  names, rejects collisions (across plugins and reserved core dirs),
 *  writes changed files only and prunes stale output when a plugin stops
 *  emitting a file or is removed. Runs even with zero declarations. */
export function writePluginOutputs(
	genAbs: string,
	plugins: SweltePlugin[],
	ctxFor: (plugin: SweltePlugin) => {
		dirs: { routesDir: string; libDir: string; outDir: string }
		declarations: SweltePluginDeclaration[]
		config: unknown
	},
	reservedTop: Set<string>
): Map<string, string[]> {
	// Validate names BEFORE any output or cleanup: names become `.swelte/`
	// dirs, so `../escape` would otherwise write outside the output root.
	for (const plugin of plugins) assertPluginName(plugin?.name)
	const owned = new Map<string, string>()
	const emitted = new Map<string, string[]>()
	for (const plugin of plugins) {
		if (!plugin.generate) continue
		let outputs: Record<string, string>
		try {
			outputs = plugin.generate(ctxFor(plugin)) ?? {}
		} catch (e) {
			throw new Error(`[swelte] plugin ${plugin.name} generate failed: ${(e as Error).message}`)
		}
		for (const [file, body] of Object.entries(outputs)) {
			if (
				!/^[A-Za-z0-9][\w.-]*(\/[\w.-]+)*\.[A-Za-z0-9]+$/.test(file) ||
				file.split('/').includes('..')
			) {
				throw new Error(`[swelte] plugin ${plugin.name}: invalid output file '${file}'`)
			}
			const rel = `${plugin.name}/${file}`
			if (reservedTop.has(rel.split('/')[0] ?? '')) {
				throw new Error(`[swelte] plugin ${plugin.name}: output '${file}' collides with a core dir`)
			}
			if (owned.has(rel)) {
				throw new Error(
					`[swelte] plugin output '${rel}' claimed twice (by ${owned.get(rel)} and ${plugin.name})`
				)
			}
			if (typeof body !== 'string') {
				throw new Error(`[swelte] plugin ${plugin.name}: output '${file}' must be a string`)
			}
			owned.set(rel, plugin.name)
		}
		const dir = join(genAbs, plugin.name)
		mkdirSync(dir, { recursive: true })
		for (const [file, body] of Object.entries(outputs)) {
			const abs = join(dir, file)
			mkdirSync(dirname(abs), { recursive: true })
			writeIfChanged(abs, body)
		}
		const prune = (d: string, prefix: string) => {
			let entries: { name: string; isDirectory: () => boolean }[] = []
			try {
				entries = readdirSync(d, { withFileTypes: true })
			} catch {
				return
			}
			for (const entry of entries) {
				const abs = join(d, entry.name)
				if (entry.isDirectory()) {
					prune(abs, `${prefix}${entry.name}/`)
					continue
				}
				if (!Object.hasOwn(outputs, `${prefix}${entry.name}`)) rmSync(abs, { force: true })
			}
		}
		prune(dir, '')
		emitted.set(
			plugin.name,
			Object.keys(outputs)
				.map((f) => `${plugin.name}/${f}`)
				.sort()
		)
	}
	try {
		const markerPath = join(genAbs, 'plugin_outputs.json')
		let previous: Record<string, string[]> = {}
		try {
			previous = JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, string[]>
		} catch {
			/* first generation */
		}
		for (const name of Object.keys(previous)) {
			// Marker keys are validated too: a poisoned marker from an older
			// run must not delete arbitrary dirs (`../../x`).
			try {
				assertPluginName(name)
			} catch {
				continue
			}
			if (emitted.has(name) || plugins.some((p) => p.name === name && p.generate)) continue
			rmSync(join(genAbs, name), { recursive: true, force: true })
		}
		writeIfChanged(markerPath, `${JSON.stringify(Object.fromEntries(emitted))}\n`)
	} catch {
		/* marker best-effort */
	}
	return emitted
}
