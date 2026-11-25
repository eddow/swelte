// Shared embedded-QuickJS archive builder (leaf, consumer-agnostic —
// never core). Compiles vendored C (`c/*.c`) with gcc into
// `<outDir>/qjs/libqjs.a`, plus per-consumer glue archives when callers
// pass `sourceDir` + `archiveName` (`libqjs_render.a` for SSR,
// `libqjs_agent.a` for the agent). (V's tcc cannot compile quickjs.c; V
// links one prebuilt archive per #flag — hence .a, not loose .o files.)
// The SSR adapter (`@swelte/ssr-qjs` `buildQjsProd` — bridge emission +
// render.js coupling) builds the engine archive and its own render archive;
// the PTC agent plugin (`@swelte/ai`) builds the engine archive and its own
// agent archive. Each consumer links its glue after the engine.
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Conda-free PATH: conda ships its own `ld` that shadows the system linker
 * and breaks every C-link step (see @swelte/core toolchain.ts). Local copy
 * so this leaf stays dependency-free (core must not know about qjs). */
function sanitizedPath(input?: string): string {
	const raw = String(input ?? process.env.PATH ?? '')
	const parts = raw.split(':').filter((p) => {
		if (!p) return false
		const low = p.toLowerCase()
		if (low.includes('conda') || low.includes('miniconda') || low.includes('mamba')) return false
		return true
	})
	if (parts.length === 0) return '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin'
	return parts.join(':')
}

export function toolchainEnv(): NodeJS.ProcessEnv {
	return { ...process.env, PATH: sanitizedPath() }
}

/** Absolute system C compiler so PATH shadowing can't win. */
export function resolveSystemCC(): string {
	for (const abs of ['/usr/bin/gcc', '/bin/gcc', '/usr/bin/cc', '/bin/cc', '/usr/bin/clang']) {
		if (existsSync(abs)) return abs
	}
	return 'gcc'
}

/** Absolute dir of the vendored C sources (`swelte_qjs.c` + glue).
 * Single resolution: the installed `@swelte/qjs` package root + `/c`
 * (assert `swelte_qjs.c` exists, else throw naming the install). */
export function qjsCDir(fromUrl: string): string {
	const pkgFile = createRequire(fromUrl).resolve('@swelte/qjs/package.json')
	const cDir = join(dirname(pkgFile), 'c')
	if (!existsSync(join(cDir, 'swelte_qjs.c'))) {
		throw new Error(
			`[swelte:qjs] vendored QuickJS not found at ${cDir} — install @swelte/qjs for the shared engine`
		)
	}
	return cDir
}

export function whichCC(): string {
	for (const cc of ['gcc', 'cc', 'clang']) {
		try {
			execSync(`${process.platform === 'win32' ? 'where' : 'which'} ${cc}`, {
				stdio: ['ignore', 'pipe', 'ignore'],
				env: toolchainEnv(),
			})
			return cc
		} catch {
			/* try next */
		}
	}
	return ''
}

/** Effective cross pair from SWELTE_TARGET_OS/ARCH env (build.ts publishes
 *  the resolved pair before vite runs). Returns '' when native. Shared by
 *  buildQjsLib + resolveTargetCc — one normalize, no drift. */
export function qjsTargetPair(): { os: string; arch: string; cross: boolean } {
	const normOs = (v: unknown): string => {
		const s = String(v ?? '')
			.trim()
			.toLowerCase()
		return s === 'linux' || s === 'macos' || s === 'windows' ? s : ''
	}
	const normArch = (v: unknown): string => {
		const s = String(v ?? '')
			.trim()
			.toLowerCase()
		if (s === 'amd64' || s === 'x64' || s === 'x86_64' || s === 'x86-64') return 'amd64'
		if (s === 'arm64' || s === 'aarch64') return 'arm64'
		return ''
	}
	const hostOs =
		process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
	const hostArch = process.arch === 'arm64' ? 'arm64' : 'amd64'
	const os = normOs(process.env.SWELTE_TARGET_OS) || hostOs
	const arch = normArch(process.env.SWELTE_TARGET_ARCH) || hostArch
	return { os, arch, cross: os !== hostOs || arch !== hostArch }
}

/** Host C compiler: system cc when present, else the vvm-managed host-pair
 *  zig-cc wrapper, else ''. Mirrors core's resolveHostCC dependency-free
 *  (consumers never import core on the build path). */
export function resolveHostNativeCC(fromUrl: string): string {
	const sys = resolveSystemCC()
	if (sys !== 'gcc') return sys
	const hostOs =
		process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
	const hostArch = process.arch === 'arm64' ? 'arm64' : 'amd64'
	const ext = process.platform === 'win32' ? '.cmd' : ''
	const candidates: string[] = []
	try {
		const require = createRequire(fromUrl)
		candidates.push(join(dirname(require.resolve('@swelte/vvm/package.json')), 'versions', 'zig'))
	} catch {
		/* not installed — sibling fallback below */
	}
	candidates.push(join(dirname(fileURLToPath(fromUrl)), '..', '..', 'vvm', 'versions', 'zig'))
	for (const dir of candidates) {
		const w = join(dir, `zig-cc-${hostOs}-${hostArch}${ext}`)
		if (existsSync(w)) return w
	}
	try {
		execSync(process.platform === 'win32' ? 'where gcc' : 'which gcc', {
			stdio: ['ignore', 'pipe', 'ignore'],
		})
		return 'gcc'
	} catch {
		return ''
	}
}

/** Resolve the zig-cc wrapper for the effective cross pair, or undefined
 *  when native. Throws with the fix when cross but no wrapper exists
 *  (PATH zig without a wrapper can't work — V needs a gcc-style `-cc`
 *  path that already carries `-target`). Dependency-free: never imports
 *  @swelte/core from the build path. */
export function resolveTargetCc(fromUrl: string): string | undefined {
	const { os, arch, cross } = qjsTargetPair()
	if (!cross) return undefined
	const ext = process.platform === 'win32' ? '.cmd' : ''
	const candidates: string[] = []
	try {
		const require = createRequire(fromUrl)
		candidates.push(join(dirname(require.resolve('@swelte/vvm/package.json')), 'versions', 'zig'))
	} catch {
		/* not installed — sibling fallback below */
	}
	candidates.push(join(dirname(fileURLToPath(fromUrl)), '..', '..', 'vvm', 'versions', 'zig'))
	for (const dir of candidates) {
		const w = join(dir, `zig-cc-${os}-${arch}${ext}`)
		if (existsSync(w)) return w
	}
	throw new Error(
		`[swelte:qjs] cross-build ${os}-${arch}: no zig-cc wrapper ` +
			`(run: npx vvm prepare --target-os ${os} --target-arch ${arch})`
	)
}

export interface QjsLibOut {
	lib: string
	cDir: string
	qjsDir: string
	cross: boolean
	effOs: string
	effArch: string
}

/** Build (or reuse, mtime-guarded) the engine archive `.swelte/qjs/libqjs.a`,
 *  or a per-consumer glue archive when `sourceDir` + `archiveName` are
 *  given (`libqjs_render.a`, `libqjs_agent.a`). The glue archives compile
 *  under the same compiler/target configuration and link after the engine. */
export function buildQjsLib(opts: {
	root: string
	outDir?: string
	/** Explicit C compiler (the zig-cc wrapper when cross). Overrides
	 *  the resolved default. */
	targetCc?: string
	fromUrl?: string
	sourceDir?: string
	archiveName?: string
}): QjsLibOut {
	const fromUrlForCc = opts.fromUrl ?? import.meta.url
	const root = resolve(opts.root)
	const outDir = String(opts.outDir ?? '.swelte')
	const genAbs = join(root, outDir)
	const qjsDir = join(genAbs, 'qjs')
	mkdirSync(qjsDir, { recursive: true })
	const engineDir = qjsCDir(fromUrlForCc)
	const cDir = opts.sourceDir ?? engineDir
	// Target pair from env (build.ts publishes the resolved effective pair
	// before vite runs). Shared normalize via qjsTargetPair — one rule.
	const { os: effOs, arch: effArch, cross } = qjsTargetPair()
	// Archive name: host keeps `libqjs.a` (bridge `#flag` compat); cross
	// gets per-target `libqjs-<os>-<arch>.a` so a stale host archive can
	// never silently link the wrong ABI. Object files are per-target too
	// (`quickjs.<os>-<arch>.o`) — one qjs/ dir, no clobber between targets.
	const archiveName = opts.archiveName ?? 'qjs'
	const lib = cross
		? join(qjsDir, `lib${archiveName}-${effOs}-${effArch}.a`)
		: join(qjsDir, `lib${archiveName}.a`)
	const objSuffix = cross ? `.${effOs}-${effArch}.o` : '.o'
	// Absolute system cc + conda-free env: conda's ld shadows the system
	// linker and breaks both this archive step and V's later `v -o` link.
	// Native prefers the system compiler, falls back to the vvm-managed
	// host zig-cc wrapper (stock Windows/macOS: no gcc — `npm i` preps it).
	// Cross: the target zig-cc wrapper (same compiler V uses for the link).
	const cc = cross
		? String(opts.targetCc ?? '') || resolveTargetCc(fromUrlForCc) || resolveSystemCC()
		: resolveHostNativeCC(fromUrlForCc)
	if (!cc)
		throw new Error(
			'[swelte:qjs] no C compiler (gcc/cc/clang) for QJS prod link — run `npx vvm prepare` (writes the host zig-cc wrapper)'
		)
	if (cross && !opts.targetCc) {
		throw new Error(
			`[swelte:qjs] cross-build ${effOs}-${effArch}: no zig-cc wrapper ` +
				`(run: npx vvm prepare --target-os ${effOs} --target-arch ${effArch})`
		)
	}
	const ccEnv = toolchainEnv()
	const cFiles = readdirSync(cDir)
		.filter((f) => f.endsWith('.c'))
		.sort()
	// quickjs.c #includes its siblings — compile it LAST so a stale
	// header cannot linger (the mtime-guard compares each source anyway).
	cFiles.sort((a, b) => (a === 'quickjs.c' ? 1 : b === 'quickjs.c' ? -1 : a.localeCompare(b)))
	let rebuild = !existsSync(lib)
	if (!rebuild) {
		try {
			const libMt = statSync(lib).mtimeMs
			for (const f of [
				...readdirSync(cDir).map((f) => join(cDir, f)),
				...readdirSync(engineDir).map((f) => join(engineDir, f)),
			]) {
				if (statSync(f).mtimeMs > libMt) {
					rebuild = true
					break
				}
			}
		} catch {
			rebuild = true
		}
	}
	if (rebuild) {
		const objs: string[] = []
		for (const f of cFiles) {
			const o = join(qjsDir, f.replace(/\.c$/, objSuffix))
			execFileSync(
				cc,
				[
					'-O2',
					'-D_GNU_SOURCE',
					'-DCONFIG_VERSION="2026-06-04"',
					'-fwrapv',
					'-fPIC',
					'-I',
					cDir,
					'-I',
					engineDir,
					'-c',
					join(cDir, f),
					'-o',
					o,
				],
				{ stdio: ['ignore', 'pipe', 'pipe'], env: ccEnv }
			)
			objs.push(o)
		}
		// `ar` from the wrapper's dir when cross (zig ships llvm-ar next
		// to zig); host PATH `ar` otherwise. Sync — this function is sync.
		let arBin = 'ar'
		const llvmAr = join(dirname(cc), process.platform === 'win32' ? 'llvm-ar.exe' : 'llvm-ar')
		if (cross && existsSync(llvmAr)) arBin = llvmAr
		rmSync(lib, { force: true })
		execFileSync(arBin, ['rcs', lib, ...objs], { stdio: ['ignore', 'pipe', 'pipe'], env: ccEnv })
	}
	return { lib, cDir, qjsDir, cross, effOs, effArch }
}
