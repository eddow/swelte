import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { writeIfChanged } from './fs.js'

export type NpmVTarget = 'universal' | 'server'

export interface NpmVExport {
	packageName: string
	packageVersion: string
	packageRoot: string
	exportKey: string
	specifier: string
	namespace: string
	modulePath: string
	moduleImport: string
	target: NpmVTarget
	sourceDir: string
	entryFile: string
	stagedDir: string
	stagedEntry: string
}

interface PackageJson {
	exports?: Record<string, unknown>
	name?: unknown
	version?: unknown
	dependencies?: Record<string, unknown>
	optionalDependencies?: Record<string, unknown>
	devDependencies?: Record<string, unknown>
	swelte?: {
		v?: {
			exports?: Record<string, { source?: unknown; entry?: unknown; target?: unknown }>
		}
	}
}

const V_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

function vPart(value: string): string {
	const out = value.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '_')
	return /^[A-Za-z_]/.test(out) ? out : `_${out}`
}

/** Stable, valid V root module for an npm package. This namespace is
 * framework-reserved, so application modules may not start with `npm_`. */
export function npmVNamespace(packageName: string): string {
	return `npm_${packageName.split('/').map(vPart).join('_')}`
}

/** `@scope/pkg/v/text/slug.v` -> package + logical export key. */
export function parseNpmVSpecifier(
	specifier: string
): { packageName: string; exportKey: string } | null {
	const parts = specifier.split('/')
	if (specifier.startsWith('@')) {
		if (parts.length < 4 || parts[2] !== 'v') return null
		const path = parts.slice(3).join('/')
		if (!path.endsWith('.v')) return null
		return { packageName: `${parts[0]}/${parts[1]}`, exportKey: `./${path}` }
	}
	if (parts.length < 3 || parts[1] !== 'v') return null
	const path = parts.slice(2).join('/')
	if (!path.endsWith('.v')) return null
	return { packageName: parts[0], exportKey: `./${path}` }
}

function packageSpecifier(packageName: string, exportKey: string): string {
	return `${packageName}/v/${exportKey.slice(2)}`
}

export function readJson(file: string): PackageJson {
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as PackageJson
	} catch (error) {
		throw new Error(`[swelte] cannot read ${file}: ${(error as Error).message}`)
	}
}

function contains(root: string, candidate: string): boolean {
	const rel = relative(root, candidate)
	return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

export function findDependencyPackage(fromRoot: string, packageName: string): string | null {
	let cursor = resolve(fromRoot)
	for (;;) {
		const candidate = join(cursor, 'node_modules', ...packageName.split('/'), 'package.json')
		if (existsSync(candidate)) return candidate
		const parent = dirname(cursor)
		if (parent === cursor) return null
		cursor = parent
	}
}

export function dependencyNames(pkg: PackageJson, includeDev: boolean): string[] {
	return [
		...Object.keys(pkg.dependencies ?? {}),
		...Object.keys(pkg.optionalDependencies ?? {}),
		...(includeDev ? Object.keys(pkg.devDependencies ?? {}) : []),
	]
}

export interface ValidatedNpmVExport {
	exportKey: string
	specifier: string
	namespace: string
	modulePath: string
	moduleImport: string
	target: NpmVTarget
	sourceDir: string
	entryFile: string
}

/** Validate one package's `swelte.v.exports` map (no staging, no I/O beyond
 * reads). Shared by the consumer path (`materializeNpmV`) and the author
 * path (`swelte check --lib`): one rule set, one error shape. */
export function validateNpmVExports(packageRoot: string, pkg: PackageJson): ValidatedNpmVExport[] {
	const packageName = typeof pkg.name === 'string' ? pkg.name : packageRoot
	const namespace = npmVNamespace(packageName)
	const exports = pkg.swelte?.v?.exports
	if (!exports) return []
	const found: ValidatedNpmVExport[] = []
	const exportByModule = new Map<string, string>()
	const exportBySpecifier = new Map<string, string>()
	for (const [exportKey, declaration] of Object.entries(exports).sort(([a], [b]) =>
		a.localeCompare(b)
	)) {
		if (!/^\.\/[A-Za-z0-9_./-]+\.v$/.test(exportKey) || exportKey.includes('/../')) {
			throw new Error(
				`[swelte] ${packageName}: invalid swelte.v export '${exportKey}' (expected ./path.v)`
			)
		}
		if (typeof declaration.source !== 'string' || typeof declaration.entry !== 'string') {
			throw new Error(
				`[swelte] ${packageName} ${exportKey}: source directory and entry .v file are required`
			)
		}
		if (
			declaration.target !== undefined &&
			declaration.target !== 'server' &&
			declaration.target !== 'universal'
		) {
			throw new Error(
				`[swelte] ${packageName} ${exportKey}: target must be 'universal' or 'server'`
			)
		}
		const target: NpmVTarget = declaration.target === 'server' ? 'server' : 'universal'
		let sourceDir = resolve(packageRoot, declaration.source)
		let entryFile = resolve(packageRoot, declaration.entry)
		if (!contains(packageRoot, sourceDir) || !contains(packageRoot, entryFile)) {
			throw new Error(`[swelte] ${packageName} ${exportKey}: source/entry escapes the package`)
		}
		if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
			throw new Error(`[swelte] ${packageName} ${exportKey}: source is not a directory`)
		}
		sourceDir = realpathSync(sourceDir)
		if (existsSync(entryFile)) entryFile = realpathSync(entryFile)
		if (!contains(packageRoot, sourceDir) || !contains(packageRoot, entryFile)) {
			throw new Error(
				`[swelte] ${packageName} ${exportKey}: source/entry symlink escapes the package`
			)
		}
		if (!contains(sourceDir, entryFile) || !existsSync(entryFile) || !entryFile.endsWith('.v')) {
			throw new Error(`[swelte] ${packageName} ${exportKey}: entry must be a .v file inside source`)
		}
		const logical = exportKey.slice(2, -2).split('/').map(vPart)
		if (logical.some((part) => !V_IDENT.test(part))) {
			throw new Error(`[swelte] ${packageName} ${exportKey}: cannot form a V module path`)
		}
		const modulePath = logical.join('.')
		const moduleImport = `${namespace}.${modulePath}`
		const moduleOwner = exportByModule.get(moduleImport)
		if (moduleOwner && moduleOwner !== exportKey) {
			throw new Error(
				`[swelte] ${packageName}: exports ${moduleOwner} and ${exportKey} both map to V module ${moduleImport}`
			)
		}
		exportByModule.set(moduleImport, exportKey)
		const moduleLeaf = logical[logical.length - 1]
		for (const file of readdirSync(sourceDir).filter((name) => name.endsWith('.v'))) {
			const source = readFileSync(join(sourceDir, file), 'utf8')
			const declaration = /^\s*module\s+([A-Za-z_][A-Za-z0-9_]*)/m.exec(source)?.[1]
			if (declaration !== moduleLeaf) {
				throw new Error(
					`[swelte] ${packageName} ${exportKey}: ${file} declares module ${declaration ?? '(missing)'}; expected ${moduleLeaf}`
				)
			}
		}
		const specifier = packageSpecifier(packageName, exportKey)
		if (exportBySpecifier.has(specifier)) {
			throw new Error(`[swelte] duplicate npm V export ${specifier}`)
		}
		exportBySpecifier.set(specifier, exportKey)
		found.push({
			exportKey,
			specifier,
			namespace,
			modulePath,
			moduleImport,
			target,
			sourceDir,
			entryFile,
		})
	}
	return found.sort((a, b) => a.specifier.localeCompare(b.specifier))
}

function walkVFiles(dir: string): string[] {
	const out: string[] = []
	const walk = (current: string) => {
		for (const item of readdirSync(current, { withFileTypes: true })) {
			const file = join(current, item.name)
			if (item.isDirectory()) walk(file)
			else if (item.isFile() && item.name.endsWith('.v')) out.push(file)
		}
	}
	walk(dir)
	return out.sort()
}

function pruneStaleVFiles(dir: string, wanted: Set<string>): void {
	if (!existsSync(dir)) return
	const walk = (current: string) => {
		for (const item of readdirSync(current, { withFileTypes: true })) {
			const file = join(current, item.name)
			if (item.isDirectory()) {
				walk(file)
				try {
					if (readdirSync(file).length === 0) rmSync(file, { recursive: true })
				} catch {
					/* generated cleanup is best-effort */
				}
			} else if (item.name.endsWith('.v') && !wanted.has(resolve(file))) {
				rmSync(file)
			}
		}
	}
	walk(dir)
}

/** Discover V exports from the application's npm dependency graph and
 * materialize them as normal V modules under `.swelte/npm_*`.
 *
 * npm package identity is retained in the TS specifier while V sees the
 * deterministic module namespace (`npm_scope_pkg.path`). */
export function materializeNpmV(root: string, genDir: string): NpmVExport[] {
	const appPackageFile = join(resolve(root), 'package.json')
	if (!existsSync(appPackageFile)) return []
	const appPackage = readJson(appPackageFile)
	const queue = dependencyNames(appPackage, true).map((name) => ({
		name,
		fromRoot: resolve(root),
	}))
	const visitedRoots = new Set<string>()
	const packageByNamespace = new Map<string, string>()
	const installedPackage = new Map<string, { root: string; version: string }>()
	const exportBySpecifier = new Map<string, NpmVExport>()
	const exportByModule = new Map<string, string>()

	while (queue.length > 0) {
		const next = queue.shift() as { name: string; fromRoot: string }
		const packageFile = findDependencyPackage(next.fromRoot, next.name)
		if (!packageFile) continue
		let packageRoot = dirname(packageFile)
		try {
			packageRoot = realpathSync(packageRoot)
		} catch {
			/* retain lexical path for a broken symlink; later reads report it */
		}
		if (visitedRoots.has(packageRoot)) continue
		visitedRoots.add(packageRoot)
		const pkg = readJson(join(packageRoot, 'package.json'))
		const packageName = typeof pkg.name === 'string' ? pkg.name : next.name
		const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0'
		const installed = installedPackage.get(packageName)
		if (installed && installed.root !== packageRoot && pkg.swelte?.v?.exports) {
			throw new Error(
				`[swelte] npm V package ${packageName} is installed more than once (${installed.version} at ${installed.root}, ${version} at ${packageRoot}); one V module version must be selected`
			)
		}
		installedPackage.set(packageName, { root: packageRoot, version })
		const namespace = npmVNamespace(packageName)
		const namespaceOwner = packageByNamespace.get(namespace)
		if (namespaceOwner && namespaceOwner !== packageName) {
			throw new Error(
				`[swelte] npm V namespace collision: ${namespaceOwner} and ${packageName} both map to ${namespace}`
			)
		}
		packageByNamespace.set(namespace, packageName)

		const exports = validateNpmVExports(packageRoot, pkg)
		if (exports.length > 0) {
			// Follow dependencies of V-aware packages so their internal npm_*
			// imports resolve, without crawling an application's entire unrelated
			// JavaScript dependency graph on every generate pass.
			for (const dependency of dependencyNames(pkg, false)) {
				queue.push({ name: dependency, fromRoot: packageRoot })
			}
		}
		for (const validated of exports) {
			const { exportKey, specifier, modulePath, moduleImport, target, sourceDir, entryFile } =
				validated
			const moduleOwner = exportByModule.get(moduleImport)
			if (moduleOwner && moduleOwner !== exportKey) {
				throw new Error(
					`[swelte] ${packageName}: exports ${moduleOwner} and ${exportKey} both map to V module ${moduleImport}`
				)
			}
			exportByModule.set(moduleImport, exportKey)
			const logical = exportKey.slice(2, -2).split('/')
			const stagedDir = join(genDir, namespace, ...logical)
			const stagedEntry = join(stagedDir, relative(sourceDir, entryFile))
			if (exportBySpecifier.has(specifier)) {
				throw new Error(`[swelte] duplicate npm V export ${specifier}`)
			}
			exportBySpecifier.set(specifier, {
				packageName,
				packageVersion: version,
				packageRoot,
				exportKey,
				specifier,
				namespace,
				modulePath,
				moduleImport,
				target,
				sourceDir,
				entryFile,
				stagedDir,
				stagedEntry,
			})
		}
	}

	const found = [...exportBySpecifier.values()].sort((a, b) =>
		a.specifier.localeCompare(b.specifier)
	)
	const expectedByNamespace = new Map<string, Set<string>>()
	for (const item of found) {
		const wanted = expectedByNamespace.get(item.namespace) ?? new Set<string>()
		for (const source of walkVFiles(item.sourceDir)) {
			const destination = join(item.stagedDir, relative(item.sourceDir, source))
			mkdirSync(dirname(destination), { recursive: true })
			writeIfChanged(destination, readFileSync(source, 'utf8'))
			wanted.add(resolve(destination))
		}
		expectedByNamespace.set(item.namespace, wanted)
	}

	const markerFile = join(genDir, 'npm_v_modules.json')
	let previous: { namespaces?: string[] } = {}
	try {
		previous = JSON.parse(readFileSync(markerFile, 'utf8')) as { namespaces?: string[] }
	} catch {
		/* first generation */
	}
	for (const namespace of previous.namespaces ?? []) {
		if (!expectedByNamespace.has(namespace) && namespace.startsWith('npm_')) {
			rmSync(join(genDir, namespace), { recursive: true, force: true })
			rmSync(join(genDir, 'dev', namespace), { recursive: true, force: true })
		}
	}
	for (const [namespace, wanted] of expectedByNamespace) {
		pruneStaleVFiles(join(genDir, namespace), wanted)
	}
	writeIfChanged(
		markerFile,
		JSON.stringify(
			{
				namespaces: [...expectedByNamespace.keys()].sort(),
				exports: found.map((item) => ({
					package: item.packageName,
					version: item.packageVersion,
					specifier: item.specifier,
					module: item.moduleImport,
					target: item.target,
				})),
			},
			null,
			2
		)
	)
	return found
}
