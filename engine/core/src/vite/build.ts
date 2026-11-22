import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SWELTE_GEN_CORE_DIRS } from '../gen/paths.js'
import { dependencyNames, findDependencyPackage, readJson } from './npm-v.js'
import { CORE_ATTRS, parseStructs, parseVFile } from './parse.js'
import { writeIfChanged } from './fs.js'
import type { RpcFn, VStruct } from './types.js'

export interface BuildPhaseFile {
	kind: 'backend' | 'lib' | 'route'
	path: string
	mod: string
	source: string
	declarations: RpcFn[]
	structs: VStruct[]
}

export interface SwelteBuildPhase {
	attrs: string[]
	module: string
	generate(files: BuildPhaseFile[]): Record<string, string>
}

interface Loaded {
	name: string
	phase: SwelteBuildPhase
	files: BuildPhaseFile[]
}

export async function loadBuildPhases(root: string, pluginAttrs: string[] = []): Promise<Loaded[]> {
	const app = join(root, 'package.json')
	if (!existsSync(app)) return []
	const phases: Loaded[] = []
	const claimed = new Set<string>([...CORE_ATTRS, ...pluginAttrs])
	for (const name of [...new Set(dependencyNames(readJson(app), true))].sort()) {
		const manifest = findDependencyPackage(root, name)
		if (!manifest) continue
		const entry = readJson(manifest).exports?.['./swelte/build']
		if (entry === undefined) continue
		if (typeof entry !== 'string' || !/^\.\/(?:[\w.-]+\/)*[\w.-]+\.(?:mjs|js)$/.test(entry) || entry.split('/').includes('..'))
			throw new Error(`[swelte] ${name}: export ./swelte/build as a compiled JS file`)
		const { default: phase } = await import(pathToFileURL(join(dirname(manifest), entry)).href) as { default: SwelteBuildPhase }
		if (!phase || typeof phase.generate !== 'function' || !Array.isArray(phase.attrs) ||
			typeof phase.module !== 'string' || !/^[a-z][a-z0-9_]*$/.test(phase.module) ||
			[...SWELTE_GEN_CORE_DIRS, 'qjs', 'main'].includes(phase.module) || phase.module.startsWith('npm_'))
			throw new Error(`[swelte] ${name}: invalid build phase`)
		for (const attr of phase.attrs) {
			if (typeof attr !== 'string' || !/^\w+$/.test(attr) || claimed.has(attr))
				throw new Error(`[swelte] ${name}: invalid or already claimed attribute ${attr}`)
			claimed.add(attr)
		}
		phases.push({ name, phase, files: [] })
	}
	return phases
}

export function phaseDeclarations(phases: Loaded[], kind: BuildPhaseFile['kind'], path: string, mod: string, source: string) {
	if (!phases.length) return
	const parsed = parseVFile(source, phases.flatMap(p => p.phase.attrs))
	for (const { phase, files } of phases) {
		const declarations = parsed.filter(fn => phase.attrs.includes(fn.attr))
		if (declarations.length) files.push({ kind, path, mod, source, declarations, structs: parseStructs(source) })
	}
}

export function writePhaseOutputs(phases: Loaded[], root: string, wanted: Set<string>, reserved: Set<string>) {
	for (const { name, phase, files } of phases) {
		if (!files.length) continue
		if (wanted.has(phase.module) || reserved.has(phase.module))
			throw new Error(`[swelte] ${name}: output module ${phase.module} already in use`)
		const outputs = phase.generate(files)
		const dir = join(root, phase.module)
		for (const [file, body] of Object.entries(outputs)) {
			if (!/^[\w-]+(?:\.[\w-]+)+$/.test(file) || typeof body !== 'string')
				throw new Error(`[swelte] ${name}: invalid output ${file}`)
		}
		wanted.add(phase.module)
		mkdirSync(dir, { recursive: true })
		for (const [file, body] of Object.entries(outputs)) writeIfChanged(join(dir, file), body)
		for (const entry of readdirSync(dir, { withFileTypes: true }))
			if (entry.isFile() && !Object.hasOwn(outputs, entry.name)) rmSync(join(dir, entry.name))
	}
}
