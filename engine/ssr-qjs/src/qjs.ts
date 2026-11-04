// QJS prod link (adapter-owned, never core).
// After `emitRenderJs` writes `dist/ssr/render.js`, `buildQjsProd`:
//  1. Compiles vendored C (c/*.c + swelte_qjs glue) with gcc into
//     `<outDir>/qjs/libqjs.a`. (V's tcc cannot compile quickjs.c; V links
//     one prebuilt archive per #flag — hence .a, not loose .o files.)
//  2. Emits the V bridge `<outDir>/routes/swelte_qjs_bridge.v`:
//     `swelte_qjs_render_page(route, props) (string, bool)` — fresh
//     runtime per call, render.js from SWELTE_DIST (mtime-guarded cache),
//     timeout + memory cap, sidecar-shaped envelope.
// Dist keeps exactly ONE ssr artifact: `dist/ssr/render.js` (the binary
// reads it at runtime — same choice as WASM app_lib, keep consistent).
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** Conda-free PATH: conda ships its own `ld` that shadows the system linker
 * and breaks every C-link step (see @swelte/core toolchain.ts). Local copy
 * so the adapter stays dependency-free (core must not know about qjs). */
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

function toolchainEnv(): NodeJS.ProcessEnv {
	return { ...process.env, PATH: sanitizedPath() }
}

/** Absolute system C compiler so PATH shadowing can't win. */
function resolveSystemCC(): string {
	for (const abs of ['/usr/bin/gcc', '/bin/gcc', '/usr/bin/cc', '/bin/cc', '/usr/bin/clang']) {
		if (existsSync(abs)) return abs
	}
	return 'gcc'
}

export function qjsCDir(fromUrl: string): string {
	const here = dirname(fileURLToPath(fromUrl))
	const candidates = [join(here, '..', 'c'), join(here, 'c')]
	for (const c of candidates) {
		if (existsSync(join(c, 'swelte_qjs.c'))) return c
	}
	return join(here, '..', 'c')
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

export interface QjsProdOut {
	lib: string
	bridge: string
	flags: string
	qjscNote: string
}

/** Effective cross pair from SWELTE_TARGET_OS/ARCH env (build.ts publishes
 *  the resolved pair before vite runs). Returns '' when native. Shared by
 *  buildQjsProd + resolveTargetCc — one normalize, no drift. */
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
 *  (the adapter never imports core on the build path). */
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
 *  @swelte/core from the adapter's build path. */
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
		`[swelte:ssr-qjs] cross-build ${os}-${arch}: no zig-cc wrapper ` +
			`(run: npx vvm prepare --target-os ${os} --target-arch ${arch})`
	)
}

export function buildQjsProd(opts: {
	root: string
	renderJs: string
	outDir?: string
	timeoutMs?: number
	memoryMB?: number
	/** Cross-build OS (build.ts publishes the resolved effective OS
	 *  via env when flags are used). Empty = host-native. */
	targetOs?: string
	/** Cross-build arch (same contract as targetOs). Empty = host-native. */
	targetArch?: string
	/** Explicit C compiler (the zig-cc wrapper when cross). Overrides
	 *  the resolved default. */
	targetCc?: string
}): QjsProdOut {
	const fromUrlForCc = import.meta.url
	const root = resolve(opts.root)
	const outDir = String(opts.outDir ?? '.swelte')
	const genAbs = join(root, outDir)
	const qjsDir = join(genAbs, 'qjs')
	mkdirSync(qjsDir, { recursive: true })
	const cDir = qjsCDir(import.meta.url)
	if (!existsSync(join(cDir, 'swelte_qjs.c'))) {
		throw new Error(`[swelte:ssr-qjs] vendored QuickJS not found at ${cDir}`)
	}
	// Target pair from env (build.ts publishes the resolved effective pair
	// before vite runs). Shared normalize via qjsTargetPair — one rule.
	const { os: effOs, arch: effArch, cross } = qjsTargetPair()
	// Archive name: host keeps `libqjs.a` (bridge `#flag` compat); cross
	// gets per-target `libqjs-<os>-<arch>.a` so a stale host archive can
	// never silently link the wrong ABI. Object files are per-target too
	// (`quickjs.<os>-<arch>.o`) — one qjs/ dir, no clobber between targets.
	const lib = cross ? join(qjsDir, `libqjs-${effOs}-${effArch}.a`) : join(qjsDir, 'libqjs.a')
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
			'[swelte:ssr-qjs] no C compiler (gcc/cc/clang) for QJS prod link — run `npx vvm prepare` (writes the host zig-cc wrapper)'
		)
	if (cross && !opts.targetCc) {
		throw new Error(
			`[swelte:ssr-qjs] cross-build ${effOs}-${effArch}: no zig-cc wrapper ` +
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
			for (const f of cFiles) {
				if (statSync(join(cDir, f)).mtimeMs > libMt) {
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
		execFileSync(arBin, ['rcs', lib, ...objs], { stdio: ['ignore', 'pipe', 'pipe'], env: ccEnv })
	}
	const timeoutMs = opts.timeoutMs ?? 50
	const memoryMB = opts.memoryMB ?? 16
	const bridge = join(genAbs, 'routes', 'swelte_qjs_bridge.v')
	mkdirSync(dirname(bridge), { recursive: true })
	writeFileSync(bridge, bridgeSrc(lib, cDir, timeoutMs, memoryMB))
	const flags = `-I ${cDir} -L ${qjsDir} -lqjs -lm -lpthread -ldl`
	return {
		lib,
		bridge,
		flags,
		qjscNote: 'QJS bytecode cached at runtime (no qjsc binary needed)',
	}
}

export function bridgeSrc(lib: string, cDir: string, timeoutMs: number, memoryMB: number): string {
	return `// Auto-generated by @swelte/ssr-qjs. Do not edit.
// QJS prod bridge (module routes): per-request runtime handle, render.js
// from SWELTE_DIST (mtime-guarded cache), 50ms/16MB guards.
//
// OWNERSHIP: the glue never returns malloc'd pointers (V 0.5.2 autofree
// would double-free them). V passes a heap buffer; C copies the HTML in
// and reports the needed length. Grow once (64KB→1MB), else SPA
// fallback (-4 empty body → SPA shell, see swelte_qjs.h). Runtimes are
// C-side ints (V truncates u64 C values to 32b).
module routes

import os

#include "swelte_qjs.h"
#flag -I ${cDir}
#flag ${lib}@START_LIBS
#flag -lm -lpthread -ldl

fn C.swelte_qjs_new_runtime() int
fn C.swelte_qjs_free_runtime(int)
fn C.swelte_qjs_render_head_body(int, &char, int, &char, int, &char, int, &char, int, &int, &char, int, &int, int, u32) int

struct SwelteQjsCached {
	mtime f64
mut:
	src string
}

__global swelte_qjs_cache SwelteQjsCached

pub fn swelte_qjs_timeout_ms() int {
	return ${timeoutMs}
}

pub fn swelte_qjs_mem_cap_mb() u32 {
	return u32(${memoryMB})
}

pub fn swelte_qjs_load_bundle() string {
	dist := os.getenv_opt('SWELTE_DIST') or { '' }
	if dist == '' {
		return ''
	}
	p := dist + '/ssr/render.js'
	st := os.stat(p) or { return '' }
	if f64(st.mtime) == swelte_qjs_cache.mtime && swelte_qjs_cache.src != '' {
		return swelte_qjs_cache.src
	}
	src := os.read_file(p) or { return '' }
	swelte_qjs_cache = SwelteQjsCached{f64(st.mtime), src}
	return src
}

// Render one page via embedded QuickJS. Returns (html, true) on success;
// any failure (no bundle, throw, timeout, OOM, too-big) → ('', false)
// → Hand falls back to SPA/static (never blank/JSON for navigations).
pub fn swelte_qjs_render_page(route string, props_json string) (string, bool) {
	src := swelte_qjs_load_bundle()
	if src == '' || src.len <= 0 || src.len > 16 * 1024 * 1024 {
		return '', false
	}
	// Heap buffers ([]u8, not fixed arrays — 1MB of stack overflows
	// constrained threads). &buf[0] requires V 0.5.x unsafe blocks.
	// Head rides the same render: 8KB covers title/meta/link; overflow
	// grows once to 64KB, else head drops (body still renders).
	mut hbuf := []u8{len: 8192}
	mut buf := []u8{len: 65536}
	mut rt := C.swelte_qjs_new_runtime()
	if rt == 0 {
		return '', false
	}
	mut need_h := 0
	mut need_b := 0
	mut rc := 0
	unsafe {
		rc = C.swelte_qjs_render_head_body(rt, src.str, src.len, route.str, route.len, props_json.str, props_json.len, &char(&hbuf[0]), hbuf.len, &need_h, &char(&buf[0]), buf.len, &need_b, swelte_qjs_timeout_ms(), swelte_qjs_mem_cap_mb())
	}
	if rc == -4 {
		// Rendered but empty: keep the SPA shell (don't escalate to +error).
		C.swelte_qjs_free_runtime(rt)
		return '', true
	}
	if rc < 0 {
		C.swelte_qjs_free_runtime(rt)
		return '', false
	}
	if need_b > buf.len - 1 {
		if need_b > 1024 * 1024 {
			C.swelte_qjs_free_runtime(rt)
			return '', false
		}
		mut big := []u8{len: 1048576}
		need_h = 0
		need_b = 0
		unsafe {
			rc = C.swelte_qjs_render_head_body(rt, src.str, src.len, route.str, route.len, props_json.str, props_json.len, &char(&hbuf[0]), hbuf.len, &need_h, &char(&big[0]), big.len, &need_b, swelte_qjs_timeout_ms(), swelte_qjs_mem_cap_mb())
		}
		if rc == -4 {
			C.swelte_qjs_free_runtime(rt)
			return '', true
		}
		if rc < 0 || need_b > big.len - 1 {
			C.swelte_qjs_free_runtime(rt)
			return '', false
		}
		s := swelte_qjs_join_head_body(hbuf, need_h, big, need_b)
		C.swelte_qjs_free_runtime(rt)
		return s, true
	}
	s := swelte_qjs_join_head_body(hbuf, need_h, buf, need_b)
	C.swelte_qjs_free_runtime(rt)
	return s, true
}

// Join head+body with an unambiguous separator (ssr-head-body marker)
// so Hand can split without escaping: head is svelte-head output
// (title/meta/link), body is the page HTML. Head overflow (>64KB) drops
// the head (body still renders).
fn swelte_qjs_join_head_body(hbuf []u8, need_h int, buf []u8, need int) string {
	mut head := ''
	if need_h > 0 && need_h <= 65536 && need_h < hbuf.len {
		head = unsafe { (&char(&hbuf[0])).vstring_with_len(need_h) }.clone()
	}
	body := unsafe { (&char(&buf[0])).vstring_with_len(need) }.clone()
	if head == '' {
		return body
	}
	return head + '<!--ssr-head-body-->' + body
}

`
}
