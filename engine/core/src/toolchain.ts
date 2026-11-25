// Shared toolchain resolution (V binary via PATH or @swelte/vvm).
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Absolute system C compiler, preferring /usr/bin/* so PATH shadowing can't win. */

/**
 * Conda (`miniconda3/bin`) ships its own `ld` that shadows the system
 * linker on PATH. `gcc` resolves `ld` via PATH, so any V C-link step
 * (`v -o`, `v run`, `v -b wasm`, vendored QuickJS `gcc -c`) fails with:
 *   `ld: /lib/x86_64-linux-gnu/libc.so.6: undefined reference to
 *    __nptl_change_stack_perm@GLIBC_PRIVATE`
 * even though the V sources are fine. Every child process that can reach
 * a C toolchain must run with conda entries stripped from PATH.
 */
export function sanitizedPath(input?: string): string {
	const raw = String(input ?? process.env.PATH ?? '')
	const parts = raw.split(':').filter((p) => {
		if (!p) return false
		const low = p.toLowerCase()
		if (low.includes('conda') || low.includes('miniconda') || low.includes('mamba')) return false
		return true
	})
	// If filtering removed everything (conda-only PATH), fall back to the
	// standard system dirs so gcc/ld remain resolvable.
	if (parts.length === 0) return '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin'
	return parts.join(':')
}

/** Env for spawning V / gcc / ar / vite: same process env but conda-free PATH. */
export function toolchainEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
	return { ...process.env, PATH: sanitizedPath(), ...extra }
}

/** Minimal `.env` loader for the Swelte CLI: reads `<root>/.env` when present
 *  and fills `process.env` for keys not already set (env wins, same rule as
 *  config). One file, `KEY=value` lines, `#` comments, optional `export`
 *  prefix and optional quotes. Keys stay server-side: the V backend inherits
 *  the CLI env; the browser never sees them. Missing/unreadable = no-op. */
export function loadDotenv(root: string): Record<string, string> {
	const loaded: Record<string, string> = {}
	let text = ''
	try {
		text = readFileSync(join(root, '.env'), 'utf8')
	} catch {
		return loaded
	}
	for (const line of text.split('\n')) {
		let trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		if (trimmed.startsWith('export ')) trimmed = trimmed.slice('export '.length).trim()
		const eq = trimmed.indexOf('=')
		if (eq <= 0) continue
		const key = trimmed.slice(0, eq).trim()
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
		let value = trimmed.slice(eq + 1).trim()
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1)
		}
		if (process.env[key] === undefined) process.env[key] = value
		loaded[key] = value
	}
	return loaded
}

/** Whether the V compile needs `-enable-globals`: the QJS bridge uses
 *  `__global`, and so do builtin/third-party V include modules (core's backend hub,
 *  the QJS bridge). Detected from the generate() outputs: a real bridge file
 *  (core's no-op stub does not count), or the plugin-modules marker.
 *  Missing marker (old generate) = bridge rule. `genAbs` is `.swelte/`. */
export function needsGlobals(genAbs: string): boolean {
	if (hasRealBridge(genAbs)) return true
	try {
		const raw = readFileSync(join(genAbs, 'plugin_modules.json'), 'utf8')
		const mods = JSON.parse(raw) as unknown
		if (Array.isArray(mods) && mods.length > 0) return true
	} catch {
		/* no marker — bridge rule above stands */
	}
	return false
}

/** Whether `.swelte/` holds a REAL QJS bridge — adapter-emitted (contains
 *  `__global`) — as opposed to core's no-op stub or nothing. Two bridge
 *  shapes count: the SSR bridge (`routes/swelte_qjs_bridge.v`, render
 *  contract) and the PTC agent bridge (`agent/agent_bridge.v`, eval
 *  contract). Either one needs the real C compiler (only quickjs.c does)
 *  and its archives under `.swelte/qjs/` (engine `libqjs.a` plus the
 *  consumer's glue: SSR `libqjs_render.a`, agent `libqjs_agent.a`).
 *  Provider-only apps emit neither: native link, no QJS. Decides the
 *  `-cc` override. */
export function hasRealBridge(genAbs: string): boolean {
	return needsQjsLink(genAbs).length > 0
}

/** Absolute `#flag`-linked archive paths every real bridge needs to link.
 *  Parsed from each bridge's `#flag <abs>@START_LIBS` lines. Empty when no
 *  real bridge exists (stub has no C deps) or when unreadable. Used to
 *  detect DANGLING bridges (a real bridge whose archive is missing — e.g.
 *  `.swelte/qjs/` cleaned without a rebuild) so dev/build can self-heal
 *  instead of dying in the linker.
 *
 *  Deduplicated: each archive path appears once no matter how many
 *  bridges link it (the engine archive is shared; each glue archive
 *  belongs to exactly one consumer). */
/** Which QJS consumer bridges exist in `.swelte/`: subset of
 *  `['ssr', 'agent']`. A bridge counts only when real (adapter/plugin
 *  emitted, contains `__global`) — core's no-op stub never counts.
 *  Provider-only apps get `[]`: native link, no QJS. */
export function needsQjsLink(genAbs: string): ('ssr' | 'agent')[] {
	const out: ('ssr' | 'agent')[] = []
	try {
		const ssr = readFileSync(join(genAbs, 'routes', 'swelte_qjs_bridge.v'), 'utf8')
		if (ssr.includes('__global')) out.push('ssr')
	} catch {
		/* no SSR bridge */
	}
	try {
		const agent = readFileSync(join(genAbs, 'agent', 'agent_bridge.v'), 'utf8')
		if (agent.includes('__global')) out.push('agent')
	} catch {
		/* no agent bridge */
	}
	return out
}

export function bridgeLinkedArchives(genAbs: string): string[] {
	const files: string[] = []
	if (needsQjsLink(genAbs).includes('ssr'))
		files.push(join(genAbs, 'routes', 'swelte_qjs_bridge.v'))
	if (needsQjsLink(genAbs).includes('agent')) files.push(join(genAbs, 'agent', 'agent_bridge.v'))
	const out: string[] = []
	for (const file of files) {
		try {
			for (const line of readFileSync(file, 'utf8').split('\n')) {
				const m = /#flag\s+(\S+)@START_LIBS/.exec(line)
				if (m && !out.includes(m[1])) out.push(m[1])
			}
		} catch {
			/* unreadable — skip */
		}
	}
	return out
}

/** Delete a dangling bridge (real bridge whose linked archives are missing)
 *  so generate() rewrites the no-op stub. Returns true when a heal happened.
 *  Heals each dangling bridge independently (SSR + agent heal separately).
 *  Never touches a healthy bridge or the stub. Dev calls this before spawn;
 *  build is left strict (a missing archive there is a real build bug). */
export function healDanglingBridge(genAbs: string): boolean {
	try {
		const missing = bridgeLinkedArchives(genAbs).filter((a) => !existsSync(a))
		if (missing.length === 0) return false
		let healed = false
		if (needsQjsLink(genAbs).includes('ssr')) {
			try {
				rmSync(join(genAbs, 'routes', 'swelte_qjs_bridge.v'))
				healed = true
			} catch {
				/* ignore */
			}
		}
		if (needsQjsLink(genAbs).includes('agent')) {
			try {
				rmSync(join(genAbs, 'agent', 'agent_bridge.v'))
				healed = true
			} catch {
				/* ignore */
			}
		}
		return healed
	} catch {
		return false
	}
}

/** Whether `/.v` harness compile needs V's bundled `db.sqlite` headers:
 *  the backend hub module (`import backend` → `db.sqlite`) is copied into
 *  `.swelte/` only when a route needs rooms/WS (usage-gated in the plugin). */
export function needsSqliteAmalgamation(genAbs: string): boolean {
	try {
		const backendDir = join(genAbs, 'backend')
		if (!existsSync(backendDir)) return false
		for (const f of readdirSync(backendDir)) {
			if (!f.endsWith('.v')) continue
			try {
				if (readFileSync(join(backendDir, f), 'utf8').includes('db.sqlite')) return true
			} catch {
				/* unreadable — ignore */
			}
		}
	} catch {
		/* no backend dir — no sqlite need */
	}
	return false
}

/** System sqlite3 headers (apt `libsqlite3-dev`): V prefers these when present. */
export function hasSystemSqlite(): boolean {
	for (const p of ['/usr/include/sqlite3.h', '/usr/local/include/sqlite3.h']) {
		try {
			if (existsSync(p)) return true
		} catch {
			/* ignore */
		}
	}
	return false
}

/**
 * Lazily ensure the SQLite amalgamation for `v` when this build needs
 * `db.sqlite` and neither the toolchain amalgamation nor system headers
 * exist. Delegates the download to vvm (`ensureSqlite`); system-V
 * toolchains are left untouched with an actionable error naming the fix.
 * Never throws when sqlite isn't needed — returns `{ needed: false }`.
 */
export async function ensureSqliteForBuild(
	vbin: string,
	genAbs: string,
	log: (m: string) => void = () => {}
): Promise<{ needed: boolean; cached: boolean }> {
	if (!needsSqliteAmalgamation(genAbs)) return { needed: false, cached: true }
	if (hasSystemSqlite()) return { needed: true, cached: true }
	const fromUrl = import.meta.url
	const require = createRequire(fromUrl)
	let vvmDir = ''
	try {
		vvmDir = dirname(require.resolve('@swelte/vvm/package.json'))
	} catch {
		/* not installed — try the monorepo sibling */
	}
	const candidates = vvmDir
		? [
				join(vvmDir, 'bin', 'vvm.js'),
				join(dirname(fileURLToPath(fromUrl)), '..', '..', 'vvm', 'bin', 'vvm.js'),
			]
		: [join(dirname(fileURLToPath(fromUrl)), '..', '..', 'vvm', 'bin', 'vvm.js')]
	for (const vvm of candidates) {
		if (!existsSync(vvm)) continue
		try {
			const mod = (await import(pathToFileURL(vvm).href)) as {
				hasSqliteAmalgamation?: (v: string, r?: string) => boolean
				ensureSqlite?: (o: {
					vbin: string
					force?: boolean
				}) => Promise<{ dir: string; cached: boolean }>
				resolveV?: (r?: string) => string
			}
			const root = dirname(dirname(vvm))
			if (mod.hasSqliteAmalgamation?.(vbin, root)) return { needed: true, cached: true }
			const ensured = await mod.ensureSqlite?.({ vbin })
			if (ensured) {
				log(`sqlite: amalgamation → ${ensured.dir}${ensured.cached ? ' (cached)' : ''}`)
				return { needed: true, cached: ensured.cached }
			}
		} catch (e) {
			throw new Error(
				`sqlite amalgamation missing for ${vbin} (${(e as Error).message}) — run: npx vvm ensure-sqlite`
			)
		}
	}
	throw new Error(
		`sqlite amalgamation missing for ${vbin} (@swelte/vvm not found — run: npx vvm ensure-sqlite, or install system headers: apt install libsqlite3-dev)`
	)
}
export function resolveCC(): string {
	for (const abs of ['/usr/bin/gcc', '/bin/gcc', '/usr/bin/cc', '/bin/cc', '/usr/bin/clang']) {
		if (existsSync(abs)) return abs
	}
	return 'gcc'
}

/** Cross-build OS (`swelte build --target-os`): V `-os` values. */
export type SwelteTargetOs = 'linux' | 'macos' | 'windows'

/** Cross-build arch (`swelte build --target-arch`): V `-arch` values.

 *  V's C backend knows `amd64 | arm64` (plus i386/arm32/rv* for embedded).

 *  Deploy targets are amd64/arm64 only — the rest are rejected at resolve. */
export type SwelteTargetArch = 'amd64' | 'arm64'

/** Host arch in V `-arch` vocabulary (`process.arch` mapped). */
export function hostTargetArch(): SwelteTargetArch {
	if (process.arch === 'arm64') return 'arm64'
	return 'amd64'
}

/** Lenient normalize for the `swelte.targetArch` config key: known arch
 *  (case-insensitive, `x64`/`x86_64`/`aarch64` aliases accepted) or `''`
 *  (= host-native). Unknown/empty → `''` (config never throws). */
export function normalizeTargetArch(raw: unknown): SwelteTargetArch | '' {
	const v = String(raw ?? '')
		.trim()
		.toLowerCase()
	if (v === 'amd64' || v === 'x64' || v === 'x86_64' || v === 'x86-64') return 'amd64'
	if (v === 'arm64' || v === 'aarch64') return 'arm64'
	return ''
}

/** Strict assert for CLI/env values: throws listing the valid set. */
export function assertTargetArch(raw: unknown, where: string): SwelteTargetArch {
	const v = normalizeTargetArch(raw)
	if (v !== '') return v
	throw new Error(`invalid ${where} '${String(raw)}' (want amd64|arm64)`)
}

/** Precedence: CLI flag wins, `SWELTE_TARGET_ARCH` middle, config fallback.
 *  Returns `''` for host-native (nothing passed). CLI/env values are
 *  strict (unknown throws); config is lenient (unknown → host). */
export function resolveTargetArch(opts: {
	cli?: unknown
	env?: unknown
	config?: unknown
}): SwelteTargetArch | '' {
	const cli = String(opts.cli ?? '').trim()
	if (cli !== '') return assertTargetArch(cli, '--target-arch')
	const env = String(opts.env ?? process.env.SWELTE_TARGET_ARCH ?? '').trim()
	if (env !== '') return assertTargetArch(env, 'SWELTE_TARGET_ARCH')
	return normalizeTargetArch(opts.config)
}

/** `v -o` flag slice for the target arch: `['-arch', arch]` or `[]` (host). */
export function vArchArgs(targetArch: SwelteTargetArch | '' | unknown): string[] {
	const t = normalizeTargetArch(targetArch)
	return t === '' ? [] : ['-arch', t]
}

/** zig `-target` triple fragment for a (os, arch) pair. Empty arch =
 *  host arch. Windows/macOS triples need no ABI suffix (zig defaults:
 *  gnu for windows, none for macos); Linux pins gnu (musl needs extra
 *  link flags for V's GC backtrace) — boots on debian:stable-slim. */
export function zigTargetTriple(
	os: SwelteTargetOs | '' | unknown,
	arch: SwelteTargetArch | '' | unknown
): string {
	const o = normalizeTargetOs(os)
	const a = normalizeTargetArch(arch) || hostTargetArch()
	const host = o === '' ? hostTargetOs() : o
	const tripleArch = a === 'arm64' ? 'aarch64' : 'x86_64'
	if (host === 'macos') return `${tripleArch}-macos`
	if (host === 'windows') return `${tripleArch}-windows-gnu`
	return `${tripleArch}-linux-gnu`
}

/** Path of the vvm-managed `zig` binary (versions/zig/zig[.exe]), or ''.

 *  Never throws — callers fall back to PATH `zig` or fail with a hint. */
export function vvmZig(fromUrl: string): string {
	try {
		const root = dirname(fileURLToPath(fromUrl))
		const require = createRequire(fromUrl)
		let vvmDir = ''
		try {
			vvmDir = dirname(require.resolve('@swelte/vvm/package.json'))
		} catch {
			/* not installed — try sibling */
		}
		const candidates = vvmDir
			? [vvmDir, join(root, '..', '..', 'vvm')]
			: [join(root, '..', '..', 'vvm')]
		for (const dir of candidates) {
			const bin = join(dir, 'versions', 'zig', process.platform === 'win32' ? 'zig.exe' : 'zig')
			if (existsSync(bin)) return bin
		}
	} catch {
		/* fall through */
	}
	return ''
}

/** Resolve a zig binary: vvm-managed first, else PATH `zig`, else ''.

 *  `vvm prepare` installs it (postinstall ensures it when a target arch
 *  is declared); `which zig` on a bare machine is the fallback. */
export function resolveZig(fromUrl: string): string {
	const managed = vvmZig(fromUrl)
	if (managed) return managed
	try {
		const probe = process.platform === 'win32' ? 'where' : 'which'
		return (
			execSync(`${probe} zig`, { stdio: ['ignore', 'pipe', 'ignore'], env: toolchainEnv() })
				.toString()
				.trim()
				.split('\n')[0] || ''
		)
	} catch {
		return ''
	}
}

/** Absolute host-pair zig-cc wrapper (`zig-cc-<hostOs>-<hostArch>`), or ''.

 *  Native builds prefer the system compiler (zero behavior change on
 *  machines that have gcc) and fall back to this — so stock Windows/macOS
 *  (no gcc) build out of `npm i` once `vvm prepare` has run. */
export function zigCcHost(fromUrl: string): string {
	return zigCcWrapper(fromUrl, hostTargetOs(), hostTargetArch())
}

/** C compiler for NATIVE builds: system cc when present, else the
 *  vvm-managed host-pair zig-cc wrapper, else '' (callers fail with the
 *  `npx vvm prepare` hint). One rule for build/dev/qjs — no drift. */
export function resolveHostCC(fromUrl: string): string {
	const sys = resolveCC()
	if (sys !== 'gcc') return sys
	// resolveCC's bare-'gcc' fallback is only usable when gcc is really on
	// PATH (Unix dev machines). Otherwise prefer the hermetic wrapper.
	const host = zigCcHost(fromUrl)
	if (host) return host
	try {
		execSync(process.platform === 'win32' ? 'where gcc' : 'which gcc', {
			stdio: ['ignore', 'pipe', 'ignore'],
			env: toolchainEnv(),
		})
		return 'gcc'
	} catch {
		return ''
	}
}

/** Absolute path of the vvm-managed zig-cc wrapper for a target, or ''.

 *  The wrapper is `<vvm>/versions/zig/zig-cc-<os>-<arch>[.cmd]` —

 *  written by `vvm prepare`. A wrapper (not bare `zig cc`) because V
 *  invokes `-cc <compiler>` with gcc-style flags; the wrapper injects
 *  `-target <triple>` before forwarding. Per-target files so concurrent
 *  builds for different targets don't race on one script. */
export function zigCcWrapper(
	fromUrl: string,
	os: SwelteTargetOs | '' | unknown,
	arch: SwelteTargetArch | '' | unknown
): string {
	const zig = resolveZig(fromUrl)
	if (!zig) return ''
	const o = normalizeTargetOs(os) || hostTargetOs()
	const a = normalizeTargetArch(arch) || hostTargetArch()
	const ext = process.platform === 'win32' ? '.cmd' : ''
	const name = `zig-cc-${o}-${a}${ext}`
	const dir = dirname(zig)
	const wrapper = join(dir, name)
	if (existsSync(wrapper)) return wrapper
	return ''
}

/** Host OS in V `-os` vocabulary (`process.platform` mapped). */
export function hostTargetOs(): SwelteTargetOs {
	if (process.platform === 'win32') return 'windows'
	if (process.platform === 'darwin') return 'macos'
	return 'linux'
}

/** Lenient normalize for the `swelte.targetOs` config key: known OS
 * (case-insensitive) or `''` (= host-native). Unknown/empty → `''`
 * (config never throws — CLI/env validation reports bad values). */
export function normalizeTargetOs(raw: unknown): SwelteTargetOs | '' {
	const v = String(raw ?? '')
		.trim()
		.toLowerCase()
	if (v === 'linux' || v === 'macos' || v === 'windows') return v
	return ''
}

/** Strict assert for CLI/env values: throws listing the valid set. */
export function assertTargetOs(raw: unknown, where: string): SwelteTargetOs {
	const v = String(raw ?? '')
		.trim()
		.toLowerCase()
	if (v === 'linux' || v === 'macos' || v === 'windows') return v
	throw new Error(`invalid ${where} '${String(raw)}' (want linux|macos|windows)`)
}

/** Precedence: CLI flag wins, `SWELTE_TARGET_OS` middle, config fallback.
 * Returns `''` for host-native (nothing passed). CLI/env values are
 * strict (unknown throws); config is lenient (unknown → host). */
export function resolveTargetOs(opts: {
	cli?: unknown
	env?: unknown
	config?: unknown
}): SwelteTargetOs | '' {
	const cli = String(opts.cli ?? '').trim()
	if (cli !== '') return assertTargetOs(cli, '--target-os')
	const env = String(opts.env ?? process.env.SWELTE_TARGET_OS ?? '').trim()
	if (env !== '') return assertTargetOs(env, 'SWELTE_TARGET_OS')
	return normalizeTargetOs(opts.config)
}

/** `v -o` flag slice for the target OS: `['-os', os]` or `[]` (host). */
export function vOsArgs(targetOs: SwelteTargetOs | '' | unknown): string[] {
	const t = normalizeTargetOs(targetOs)
	return t === '' ? [] : ['-os', t]
}

export function whichV(): string {
	try {
		const probe = process.platform === 'win32' ? 'where' : 'which'
		return (
			execSync(`${probe} v`, { stdio: ['ignore', 'pipe', 'ignore'], env: toolchainEnv() })
				.toString()
				.trim()
				.split('\n')[0] || ''
		)
	} catch {
		return ''
	}
}

export function vvmV(fromUrl: string): string {
	const root = dirname(fileURLToPath(fromUrl))
	const require = createRequire(fromUrl)
	const candidates: string[] = []
	try {
		candidates.push(join(dirname(require.resolve('@swelte/vvm/package.json')), 'bin', 'vvm.js'))
	} catch {
		/* not installed — try sibling */
	}
	candidates.push(join(root, '..', '..', 'vvm', 'bin', 'vvm.js'))
	for (const vvm of candidates) {
		if (!existsSync(vvm)) continue
		try {
			const bin = execFileSync(process.execPath, [vvm, 'which'], {
				stdio: ['ignore', 'pipe', 'ignore'],
				env: toolchainEnv(),
			})
				.toString()
				.trim()
			if (bin) return bin
		} catch {
			/* try next */
		}
	}
	return ''
}

export function resolveV(fromUrl: string): string {
	return whichV() || vvmV(fromUrl) || 'v'
}

export function vVersion(vbin: string): string {
	try {
		return execFileSync(vbin, ['version'], { env: toolchainEnv() }).toString().trim()
	} catch {
		return '(not found — run `vvm install 0.5.2`)'
	}
}
