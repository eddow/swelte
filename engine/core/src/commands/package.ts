// `swelte package`: library publish build for the JS/Svelte half.
// Wraps `@sveltejs/package`'s build core with Swelte-owned defaults so it
// never assumes a SvelteKit host: temp output goes under `.swelte/`
// (already gitignored, never `.svelte-kit`), the input alias is always
// `#lib`, and no `kit.*` config keys are read. The tool only compiles
// Svelte/TS sources — it brings no SvelteKit routing, SSR or deployment.
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface PackageOptions {
	/** Project root (default: cwd). */
	root?: string
	/** Library source dir, relative (default: configured libDir, otherwise `src/lib`). */
	input?: string
	/** Publish output dir, relative (default: `package`). */
	output?: string
	/** Emit `.d.ts` declarations (default: true). */
	types?: boolean
	/** tsconfig/jsconfig for declaration emit (default: tool searches upward). */
	tsconfig?: string
}

export async function runPackage(
	opts: PackageOptions = {}
): Promise<{ outDir: string; tempDir: string }> {
	const root = resolve(opts.root ?? process.cwd())
	const output = opts.output ?? 'package'
	// Keep the publish build separate from application and source outputs.
	const { loadConfig } = await import('../gen/config.js')
	const cfg = await loadConfig(root)
	const input = opts.input ?? cfg.libDir
	if (!existsSync(resolve(root, input)))
		throw new Error(`swelte package: input ${input} does not exist`)
	const outDir = resolve(root, output)
	const overlaps = (a: string, b: string) => {
		const rel = relative(a, b)
		return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
	}
	if (
		!overlaps(root, outDir) ||
		[
			root,
			resolve(root, 'src'),
			resolve(root, input),
			resolve(root, cfg.routesDir),
			resolve(root, cfg.distDir),
			resolve(root, cfg.outDir),
			resolve(root, '.swelte'),
			resolve(root, 'node_modules'),
		].some((dir) =>
			dir === root ? outDir === root : overlaps(dir, outDir) || overlaps(outDir, dir)
		)
	)
		throw new Error(
			'swelte package: output must be inside the project and separate from source, application and generated directories'
		)
	const { collectLibDiagnostics } = await import('../gen/diagnostics.js')
	const diagnostics = collectLibDiagnostics(root, {
		output: relative(root, outDir).split(sep).join('/'),
		routesDir: cfg.routesDir,
		distDir: cfg.distDir,
	})
	if (diagnostics.length)
		throw new Error(
			`swelte package: invalid publication metadata:\n${diagnostics.map((d) => `[${d.kind}] ${d.message}`).join('\n')}`
		)
	// Core owns the packager as a dependency (like vite for dev/build).
	// Untyped deep import (no exports map): resolve via require, like dev.ts
	// does for optional adapter entry points.
	const { createRequire } = await import('node:module')
	const { pathToFileURL } = await import('node:url')
	const selfRequire = createRequire(pathToFileURL(join(import.meta.dirname, 'package.js')).href)
	// No exports map (only ./package.json): resolve the root, join the file.
	const pkgRoot = join(selfRequire.resolve('@sveltejs/package/package.json'), '..')
	const { build } = (await import(pathToFileURL(join(pkgRoot, 'src', 'index.js')).href)) as {
		build: (o: Record<string, unknown>) => Promise<void>
	}
	const tempDir = join(root, '.swelte', 'package', '__package__')
	await build({
		cwd: root,
		input,
		output,
		preserve_output: false,
		types: opts.types ?? true,
		...(opts.tsconfig ? { tsconfig: opts.tsconfig } : {}),
		config: {
			// Swelte-owned stand-ins for the kit.* keys the packager reads:
			// temp + alias resolve here and never touch `.svelte-kit` or
			// SvelteKit config shape.
			kit: { outDir: join('.swelte', 'package'), files: { lib: input }, alias: { '#lib': input } },
			extensions: ['.svelte'],
		},
	})
	return { outDir, tempDir }
}
