import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isBackendMod, SWELTE_GEN_CORE_DIRS } from '../gen/paths.js'
import { writeIfChanged } from './fs.js'
import { listVFiles, relPosix } from './routes.js'

/** Stage native-only app modules alongside generated routes and plugin modules.
 * App files win over staged plugin copies: the scaffolded
 * `src/lib/backend/db.v` shadows the Plus `db` plugin's staged `db.v`
 * (same rel path) — the plugin copy is skipped, never a collision error.
 * Other collisions (app file vs a DIFFERENT plugin file at the same path)
 * still throw. */
export function stageBackendModules(
	lib: string,
	output: string,
	pluginFiles: Set<string>
): string[] {
	const files = new Map<string, string>()
	// Basenames the Plus `db` plugin may stage: the app scaffold shadows
	// these (identical origin — `swelte migrate` copies verbatim).
	const shadowable = new Set(['db.v'])
	if (existsSync(lib))
		for (const file of listVFiles(lib)) {
			const relative = relPosix(lib, file)
			if (!isBackendMod(relative.replace(/\.v$/, ''))) continue
			const source = readFileSync(file, 'utf8')
			const module = source.match(/^\s*module\s+(\w+)/m)?.[1]
			const target = relative.includes('/') ? relative : `${module}/${relative}`
			const root = target.split('/')[0]
			if (
				!module ||
				SWELTE_GEN_CORE_DIRS.includes(root) ||
				root === 'qjs' ||
				root.startsWith('npm_')
			) {
				throw new Error(`[swelte] ${file}: invalid or reserved native module directory`)
			}
			if (pluginFiles.has(target) && !(target === 'backend/db.v' && shadowable.has(target.split('/').pop() ?? ''))) {
				throw new Error(`[swelte] ${file}: native module file collides with plugin ${target}`)
			}
			files.set(target, source)
		}
	const manifest = join(output, 'backend_files.json')
	let previous: string[] = []
	try {
		previous = JSON.parse(readFileSync(manifest, 'utf8'))
	} catch {
		/* first generation */
	}
	for (const file of previous) {
		if (!files.has(file) && !pluginFiles.has(file) && !file.split('/').includes('..'))
			rmSync(join(output, file), { force: true })
	}
	for (const [file, source] of files) {
		mkdirSync(dirname(join(output, file)), { recursive: true })
		writeIfChanged(join(output, file), source)
	}
	writeIfChanged(manifest, JSON.stringify([...files.keys()].sort()))
	return [...new Set([...files.keys()].map((file) => file.split('/')[0]))]
}
