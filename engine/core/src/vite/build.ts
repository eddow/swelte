import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dependencyNames, findDependencyPackage, readJson } from './npm-v.js'

/** Guard against the retired `./swelte/build` auto-discovery prototype
 *  (replaced by explicit `swelte({ plugins: [...] })` registration —
 *  see docs/specs/plugins.md §2). Throws naming the offending
 *  dependency; otherwise returns []. Types stay so older published
 *  `.d.ts` consumers keep importing. */
export async function loadBuildPhases(root: string, _pluginAttrs: string[] = []): Promise<never[]> {
	const app = join(root, 'package.json')
	if (!existsSync(app)) return []
	for (const name of [...new Set(dependencyNames(readJson(app), true))].sort()) {
		const manifest = findDependencyPackage(root, name)
		if (!manifest) continue
		const entry = readJson(manifest).exports?.['./swelte/build']
		if (entry === undefined) continue
		throw new Error(
			`[swelte] ${name}: automatic ./swelte/build discovery is retired — register explicitly via swelte({ plugins: [...] }) (see docs/specs/plugins.md §2).`
		)
	}
	return []
}

export function phaseDeclarations(
	_phases: never[],
	_kind: 'backend' | 'lib' | 'route',
	_path: string,
	_mod: string,
	_source: string
): void {
	// Retired with auto-discovery: explicit plugins receive claimed
	// declarations through `collectPluginDeclarations` instead.
}

export function writePhaseOutputs(
	_phases: never[],
	_root: string,
	_wanted: Set<string>,
	_reserved: Set<string>
): void {
	// Retired with auto-discovery: explicit plugins emit through
	// `writePluginOutputs` (`.swelte/<name>/...`) instead.
}
