#!/usr/bin/env node
// vvm — V Version Manager (nvm for V).
// Installs V toolchains into <vvm>/versions/<version>/ and exposes the
// active one via node_modules/.bin/v (npm bin-link to bin/v-shim.js).
import { execFileSync } from 'node:child_process'
import {
	chmodSync,
	createWriteStream,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// Single truth: package.json version. No hardcoded VVM_VERSION constant.
export const VVM_VERSION = require('../package.json').version
export const DEFAULT_V_VERSION = '0.5.2'

const HERE = dirname(fileURLToPath(import.meta.url))
// NOTE: in an npm/pnpm workspace this package is symlinked into node_modules,
// so import.meta.url resolves to the real source dir (engine/vvm). When
// installed from the registry it resolves to node_modules/@swelte/vvm.
// VVM_ROOT env overrides both (also honoured by bin/v-shim.js).
export const VVM_ROOT = process.env.VVM_ROOT ? resolve(process.env.VVM_ROOT) : resolve(HERE, '..')

const ASSETS = {
	'linux-x64': 'v_linux.zip',
	'linux-arm64': 'v_linux_arm64.zip',
	'darwin-arm64': 'v_macos_arm64.zip',
	'darwin-x64': 'v_macos_x86_64.zip',
	'win32-x64': 'v_windows.zip',
}

export function platformKey() {
	const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
	const key = `${process.platform}-${arch}`
	if (ASSETS[key]) return key
	if (process.platform === 'win32') return 'win32-x64'
	return key
}

export function versionsDir(root = VVM_ROOT) {
	return join(root, 'versions')
}

export function versionDir(version, root = VVM_ROOT) {
	return join(versionsDir(root), `v${version.replace(/^v/, '')}`)
}

export function vBinary(dir) {
	return join(dir, process.platform === 'win32' ? 'v.exe' : 'v')
}

export function listInstalled(root = VVM_ROOT) {
	const dir = versionsDir(root)
	if (!existsSync(dir)) return []
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && existsSync(vBinary(join(dir, e.name))))
		.map((e) => e.name.replace(/^v/, ''))
		.filter((v) => !VERSION_ALIASES.has(v.toLowerCase()))
		.sort(compareVersions)
}

export function activeVersion(root = VVM_ROOT) {
	const file = join(root, '.active-version')
	if (!existsSync(file)) return ''
	return readFileSync(file, 'utf8').trim()
}

export function setActiveVersion(version, root = VVM_ROOT) {
	const v = String(version).trim().toLowerCase() === 'system' ? 'system' : version.replace(/^v/, '')
	writeFileSync(join(root, '.active-version'), `${v}\n`)
}

/** Path of the `.active-system-path` pin file (remembers the adopted system `v`). */
export function activeSystemPathFile(root = VVM_ROOT) {
	return join(root, '.active-system-path')
}

/** Pinned system `v` path (written by `use system`), or ''. */
export function activeSystemPath(root = VVM_ROOT) {
	const file = activeSystemPathFile(root)
	if (!existsSync(file)) return ''
	return readFileSync(file, 'utf8').trim()
}

function setActiveSystemPath(path, root = VVM_ROOT) {
	writeFileSync(activeSystemPathFile(root), `${path}\n`)
}

/** Whether `p` points inside vvm's own managed tree (versions/, or this package). */
function isVvmOwned(p, root = VVM_ROOT) {
	try {
		const real = realpathSync(resolve(String(p)))
		const vdir = resolve(versionsDir(root))
		if (real === vdir || real.startsWith(`${vdir}/`)) return true
		const here = resolve(HERE, '..')
		if (real === here || real.startsWith(`${here}/`)) return true
	} catch {
		return false
	}
	return false
}

/** Looks like the npm `v` bin-shim (`bin/v-shim.js` forwarder), not a real V toolchain. */
function isNodeShim(p) {
	try {
		const body = readFileSync(resolve(String(p)), 'utf8')
		return body.includes('v-shim') || body.includes('#!/usr/bin/env node')
	} catch {
		return false
	}
}

/**
 * System `v` on PATH — a *real* toolchain binary, never vvm's own link or
 * shim (self-loop guard). Returns the absolute path or ''. Honors
 * `VVM_SYSTEM_V` to point at an explicit binary (useful on Windows).
 */
export function systemVBinary({ root = VVM_ROOT, extraDir } = {}) {
	const explicit = process.env.VVM_SYSTEM_V
	const probe = process.platform === 'win32' ? 'where' : 'which'
	const candidates = []
	if (explicit) candidates.push(explicit)
	// Our own link dir is honoured last: `use system` runs while the link
	// still points at the managed toolchain (re-point only on explicit refresh).
	const linkDir = resolve(process.env.VVM_LINK_DIR || defaultLinkDir())
	const linkFile = join(linkDir, linkName())
	let ownLinkTarget = ''
	try {
		const seen = linkResolution(linkFile)
		if (seen.kind === 'symlink') ownLinkTarget = resolve(linkDir, seen.target)
	} catch {
		/* ignore — live probe below handles it */
	}
	const linkReal = (() => {
		try {
			return realpathSync(linkFile)
		} catch {
			return ''
		}
	})()
	try {
		const out = execFileSync(probe, ['v'], { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim()
		for (const line of out.split(/\r?\n/)) {
			const p = line.trim()
			if (p) candidates.push(p)
		}
	} catch {
		/* no `v` on PATH */
	}
	if (extraDir)
		candidates.push(join(resolve(extraDir), process.platform === 'win32' ? 'v.exe' : 'v'))
	for (const c of candidates) {
		try {
			const abs = resolve(String(c))
			if (!existsSync(abs)) continue
			if (resolve(abs) === resolve(linkFile)) continue // our own link entry-point
			let real = abs
			try {
				real = realpathSync(abs)
			} catch {
				/* unresolvable — compare literal below */
			}
			if (linkReal && real === linkReal) continue // resolves through our own link
			if (ownLinkTarget && (real === ownLinkTarget || abs === ownLinkTarget)) continue
			if (isVvmOwned(real, root) || isVvmOwned(abs, root)) continue // managed toolchain / this package
			if (isNodeShim(real) || isNodeShim(abs)) continue // node_modules/.bin/v forwarder
			// Must answer `v version` like a real V toolchain.
			const out = execFileSync(real, ['version'], {
				stdio: ['ignore', 'pipe', 'ignore'],
			}).toString()
			if (/V\s+\d+\.\d+\.\d+/i.test(out)) return real
		} catch {
			/* not a usable V — try next */
		}
	}
	return ''
}

/** `X.Y.Z` reported by `<bin> version`, or ''. */
export function systemVVersion(bin) {
	try {
		const out = execFileSync(bin, ['version'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
		const m = /V\s+(\d+\.\d+\.\d+)/i.exec(out)
		return m ? m[1] : ''
	} catch {
		return ''
	}
}

/** Info about the system V: `{ path, version }` (either may be ''). */
export function systemVInfo(opts = {}) {
	const path = systemVBinary(opts)
	return { path, version: path ? systemVVersion(path) : '' }
}

/** Whether the system V is currently the active toolchain. */
export function isSystemActive(root = VVM_ROOT) {
	return activeVersion(root).trim().toLowerCase() === 'system'
}

export function resolveV(root = VVM_ROOT) {
	if (isSystemActive(root)) {
		// Pinned path first (survives PATH changes); live probe as fallback
		// (follows system upgrades); '' when the system V is gone.
		const pinned = activeSystemPath(root)
		if (pinned) {
			try {
				if (existsSync(pinned)) return pinned
			} catch {
				/* fall through to live probe */
			}
		}
		return systemVBinary({ root })
	}
	const active = activeVersion(root)
	if (active && active.trim().toLowerCase() !== 'system') {
		const bin = vBinary(versionDir(active, root))
		if (existsSync(bin)) return bin
	}
	const installed = listInstalled(root)
	if (installed.length > 0) return vBinary(versionDir(installed[installed.length - 1], root))
	return ''
}

// --- System link (`vvm link`) -------------------------------------------
// VSCode's V extension (and any bare `v` on PATH) needs a *global* V,
// while vvm deliberately keeps toolchains inside node_modules. `vvm link`
// bridges the two: it places a tiny `v` entry-point in a directory that
// is already on PATH (default `~/.local/bin`), forwarding to the active
// vvm-managed binary. Opt-in only — vvm never touches the system by
// itself unless VVM_LINK=1 (or `postinstall --link`) says so.
//
// POSIX: a symlink (`~/.local/bin/v` -> `<vvm>/versions/vX.Y.Z/v`).
// Verified: V resolves vlib through the symlink target, `v run` works.
// Windows: a `v.cmd` shim (`@"<bin>" %*`) — symlinks need privileges.

/** Default link dir: `~/.local/bin` (POSIX), `%LOCALAPPDATA%/vvm/bin` (win32). */
export function defaultLinkDir() {
	if (process.platform === 'win32')
		return process.env.LOCALAPPDATA
			? join(process.env.LOCALAPPDATA, 'vvm', 'bin')
			: join(homedir(), 'vvm', 'bin')
	return join(homedir(), '.local', 'bin')
}

/** Basename of the link entry (`v` / `v.cmd`). */
export function linkName() {
	return process.platform === 'win32' ? 'v.cmd' : 'v'
}

function linkResolution(linkFile) {
	try {
		if (!existsSync(linkFile) && !lstatSync(linkFile).isSymbolicLink()) return { kind: 'missing' }
	} catch {
		return { kind: 'missing' }
	}
	try {
		if (lstatSync(linkFile).isSymbolicLink())
			return { kind: 'symlink', target: readlinkSync(linkFile) }
	} catch {
		return { kind: 'missing' }
	}
	try {
		const body = readFileSync(linkFile, 'utf8')
		const m = /"([^"]+v(?:\.exe)?)"/.exec(body)
		return { kind: 'file', target: m ? m[1] : '' }
	} catch {
		return { kind: 'file', target: '' }
	}
}

/**
 * Point `dir/v` at the active vvm binary (symlink on POSIX, `v.cmd` shim
 * on Windows). Idempotent: re-running refreshes a stale link. Refuses to
 * clobber a non-vvm `v` unless `force` is set. Returns the link path.
 */
export function linkSystemV({ dir, force = false, root = VVM_ROOT } = {}) {
	const targetBin = resolveV(root)
	if (!targetBin) throw new Error('no V installed (run: vvm install 0.5.2)')
	const linkDir = resolve(dir || process.env.VVM_LINK_DIR || defaultLinkDir())
	const linkFile = join(linkDir, linkName())
	mkdirSync(linkDir, { recursive: true })
	const seen = linkResolution(linkFile)
	if (seen.kind !== 'missing') {
		let pointsAt = ''
		try {
			pointsAt = seen.kind === 'symlink' ? resolve(linkDir, seen.target) : String(seen.target || '')
		} catch {
			/* unresolvable — treat as foreign */
		}
		if (resolve(pointsAt) === resolve(targetBin)) return linkFile // already good
		if (!force && pointsAt !== '') {
			// A vvm-looking link pointing elsewhere: refresh it (version switch).
			const managed = linkDirOfVvm(pointsAt, root)
			if (!managed)
				throw new Error(`refusing to overwrite ${linkFile} (not a vvm link — use --force)`)
		} else if (!force) {
			throw new Error(`refusing to overwrite ${linkFile} (not a vvm link — use --force)`)
		}
		rmSync(linkFile, { force: true })
	}
	if (process.platform === 'win32') {
		writeFileSync(linkFile, `@"${targetBin}" %*\r\n`)
	} else {
		try {
			symlinkSync(targetBin, linkFile)
		} catch (err) {
			// ~/.local/bin on a FS that rejects symlinks: fall back to a sh shim.
			if (err?.code !== 'EPERM' && err?.code !== 'EACCES' && err?.code !== 'EXDEV') throw err
			writeFileSync(linkFile, `#!/bin/sh\nexec "${targetBin}" "$@"\n`)
			try {
				chmodSync(linkFile, 0o755)
			} catch {
				/* best effort */
			}
		}
		try {
			chmodSync(linkFile, 0o755)
		} catch {
			/* best effort (symlink chmod follows target on some platforms) */
		}
	}
	return linkFile
}

/** Remove the system link created by `linkSystemV` (only if vvm-looking). */
export function unlinkSystemV({ dir, force = false, root = VVM_ROOT } = {}) {
	const linkDir = resolve(dir || process.env.VVM_LINK_DIR || defaultLinkDir())
	const linkFile = join(linkDir, linkName())
	const seen = linkResolution(linkFile)
	if (seen.kind === 'missing') return ''
	if (!force) {
		const target =
			seen.kind === 'symlink' ? resolve(linkDir, seen.target) : String(seen.target || '')
		if (!linkDirOfVvm(target, root) && target !== resolveV(root))
			throw new Error(`refusing to remove ${linkFile} (not a vvm link — use --force)`)
	}
	rmSync(linkFile, { force: true })
	return linkFile
}

/** Current link state: `{ linkFile, target, ok }`.
 *  `ok` means the link resolves to the *currently active* V and that
 *  resolution is meaningful: for a managed active it must equal the
 *  managed binary; for an active system V the link is stale by definition
 *  (system is global already — anything the link points at is redundant). */
export function linkStatus({ dir, root = VVM_ROOT } = {}) {
	const linkDir = resolve(dir || process.env.VVM_LINK_DIR || defaultLinkDir())
	const linkFile = join(linkDir, linkName())
	const seen = linkResolution(linkFile)
	if (seen.kind === 'missing') return { linkFile, target: '', ok: false }
	const target = seen.kind === 'symlink' ? resolve(linkDir, seen.target) : String(seen.target || '')
	if (target === '') return { linkFile, target, ok: false }
	try {
		if (isSystemActive(root)) return { linkFile, target, ok: false }
		return { linkFile, target, ok: resolve(target) === resolve(resolveV(root)) }
	} catch {
		return { linkFile, target, ok: false }
	}
}

function linkDirOfVvm(target, root) {
	try {
		const vvmVersions = resolve(versionsDir(root))
		return resolve(target).startsWith(`${vvmVersions}/`)
	} catch {
		return false
	}
}

// Aliases accepted anywhere a version is expected: latest (+ stable/lts/current),
// optional leading `v` (v0.5.2 == 0.5.2).
export const VERSION_ALIASES = new Set(['latest', 'stable', 'lts', 'current'])

export function normalizeVersion(input) {
	const v = String(input || '')
		.trim()
		.replace(/^v/i, '')
		.toLowerCase()
	if (VERSION_ALIASES.has(v)) return 'latest'
	return v
}

function semverParts(v) {
	return v.split('.').map((n) => {
		const m = /^\d+/.exec(n)
		return m ? parseInt(m[0], 10) : -1
	})
}

export function compareVersions(a, b) {
	const pa = semverParts(a)
	const pb = semverParts(b)
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0)
		if (d !== 0) return d
	}
	return a < b ? -1 : a > b ? 1 : 0
}

function detectVersion(bin) {
	try {
		const out = execFileSync(bin, ['version']).toString().trim()
		const m = out.match(/V\s+(\d+\.\d+\.\d+)/i)
		return m ? m[1] : ''
	} catch {
		return ''
	}
}

export function downloadUrl(version, asset) {
	const tag = String(version).replace(/^v/i, '')
	if (tag.toLowerCase() === 'latest')
		return `https://github.com/vlang/v/releases/latest/download/${asset}`
	return `https://github.com/vlang/v/releases/download/${tag}/${asset}`
}

async function download(url, dest) {
	const res = await fetch(url, { redirect: 'follow' })
	if (!res.ok || !res.body) throw new Error(`download failed (${res.status}) for ${url}`)
	mkdirSync(dirname(dest), { recursive: true })
	await pipeline(res.body, createWriteStream(dest))
}

function extract(zipFile, outDir) {
	mkdirSync(outDir, { recursive: true })
	if (process.platform === 'win32') {
		execFileSync(
			'powershell',
			['-NoProfile', '-Command', `Expand-Archive -Force '${zipFile}' '${outDir}'`],
			{ stdio: 'inherit' }
		)
		return
	}
	try {
		execFileSync('unzip', ['-q', '-o', zipFile, '-d', outDir], { stdio: 'inherit' })
	} catch {
		execFileSync('tar', ['-xf', zipFile, '-C', outDir], { stdio: 'inherit' })
	}
}

function flattenSingleDir(dir) {
	const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== '__MACOSX')
	if (entries.length === 1 && entries[0].isDirectory()) {
		const inner = join(dir, entries[0].name)
		const tmp = join(dir, `__vvm_inner_${Date.now()}`)
		renameSync(inner, tmp)
		for (const e of readdirSync(tmp)) renameSync(join(tmp, e), join(dir, e))
		rmSync(tmp, { recursive: true })
	}
}

export async function installVersion(version, { force = false, root = VVM_ROOT } = {}) {
	const key = platformKey()
	const asset = ASSETS[key]
	if (!asset) throw new Error(`unsupported platform "${key}" (${process.platform}/${process.arch})`)
	const tag = normalizeVersion(version)
	const isAlias = tag === 'latest'
	let dir = versionDir(tag, root)
	let bin = vBinary(dir)
	if (!isAlias && !force && existsSync(bin)) {
		const out = execFileSync(bin, ['version']).toString().trim()
		console.log(`${out} → already installed at ${dir}`)
		return dir
	}
	const url = downloadUrl(version, asset)
	const zipFile = join(tmpdir(), `vvm-v-${Date.now()}-${asset}`)
	const stageDir = join(versionsDir(root), `.stage-${Date.now()}`)
	console.log(`vvm: downloading ${url}`)
	await download(url, zipFile)
	console.log(`vvm: extracting to ${dir}`)
	rmSync(stageDir, { recursive: true, force: true })
	mkdirSync(stageDir, { recursive: true })
	extract(zipFile, stageDir)
	flattenSingleDir(stageDir)
	rmSync(dir, { recursive: true, force: true })
	mkdirSync(versionsDir(root), { recursive: true })
	renameSync(stageDir, dir)
	rmSync(zipFile, { force: true })
	// `latest` is a download alias — store the toolchain under its real version
	// (e.g. versions/v0.5.2) instead of versions/vlatest.
	let finalTag = tag
	if (isAlias) {
		const detected = detectVersion(bin)
		if (detected) {
			finalTag = detected
			const finalDir = versionDir(finalTag, root)
			if (!force && existsSync(vBinary(finalDir))) {
				rmSync(dir, { recursive: true, force: true })
				console.log(`vvm: latest is ${finalTag} — already installed at ${finalDir}`)
				dir = finalDir
				bin = vBinary(dir)
			} else {
				rmSync(finalDir, { recursive: true, force: true })
				renameSync(dir, finalDir)
				dir = finalDir
				bin = vBinary(dir)
			}
			// migrate pre-fix `vlatest` leftovers / active pointer
			if (activeVersion(root) === 'latest') setActiveVersion(finalTag, root)
		}
	}
	const out = execFileSync(bin, ['version']).toString().trim()
	console.log(`vvm: ${out} → ${dir}`)
	if (!activeVersion(root)) {
		setActiveVersion(finalTag, root)
		console.log(`vvm: using ${finalTag} (default — first install)`)
	}
	return dir
}

export const DEFAULT_ZIG_VERSION = '0.15.2'

export const DEFAULT_SQLITE_VERSION = '3.54.1'
export const DEFAULT_SQLITE_AMALGAMATION = '3540100'

const ZIG_ASSETS = {
	'linux-x64': 'zig-x86_64-linux-{v}.tar.xz',
	'linux-arm64': 'zig-aarch64-linux-{v}.tar.xz',
	'darwin-arm64': 'zig-aarch64-macos-{v}.tar.xz',
	'darwin-x64': 'zig-x86_64-macos-{v}.tar.xz',
	'win32-x64': 'zig-x86_64-windows-{v}.zip',
	'win32-arm64': 'zig-aarch64-windows-{v}.zip',
}

/** Normalize a target OS value (aliases + case-insensitive). */
export function normalizeTargetOsName(raw) {
	const v = String(raw ?? '')
		.trim()
		.toLowerCase()
	if (v === 'linux') return 'linux'
	if (v === 'macos' || v === 'mac' || v === 'darwin') return 'macos'
	if (v === 'windows' || v === 'win32' || v === 'win') return 'windows'
	return ''
}

/** V toolchain root for a resolved `v` binary (follows symlinks: vvm's
 *  `~/.local/bin/v` link → `versions/vX.Y.Z/v`, so `dirname` alone would
 *  point at the link dir). */
export function vToolchainDir(vbin) {
	try {
		return dirname(realpathSync(resolve(String(vbin || ''))))
	} catch {
		return dirname(resolve(String(vbin || '')))
	}
}

/** Where V's `db.sqlite` looks for the amalgamation (`<toolchain>/thirdparty/sqlite`). */
export function sqliteDirForV(vbin) {
	return join(vToolchainDir(vbin), 'thirdparty', 'sqlite')
}

/** Whether the SQLite amalgamation is present for this `v` binary. */
export function hasSqliteAmalgamation(vbin) {
	try {
		const dir = sqliteDirForV(vbin)
		return existsSync(join(dir, 'sqlite3.c')) && existsSync(join(dir, 'sqlite3.h'))
	} catch {
		return false
	}
}

/** SQLite amalgamation download URL for a version (`3.54.1` → `.../2026/sqlite-amalgamation-3540100.zip`). */
export function sqliteDownloadUrl(
	version = DEFAULT_SQLITE_VERSION,
	amalgamation = DEFAULT_SQLITE_AMALGAMATION
) {
	// sqlite.org paths the zip by release year; pin the known-good mapping.
	const known = { '3.54.1': '2026' }
	const dir = known[String(version)] ?? '2026'
	return `https://sqlite.org/${dir}/sqlite-amalgamation-${amalgamation}.zip`
}

/** Download + extract the SQLite amalgamation into `<toolchain>/thirdparty/sqlite/`
 *  (idempotent unless force). Called lazily by core only when a build needs
 *  `db.sqlite` and the headers are absent — never on install. */
export async function ensureSqlite({ vbin, force = false, root = VVM_ROOT } = {}) {
	const dir = sqliteDirForV(vbin, root)
	if (!force && existsSync(join(dir, 'sqlite3.c')) && existsSync(join(dir, 'sqlite3.h'))) {
		return { dir, cached: true }
	}
	if (!vbin) throw new Error('vvm ensure-sqlite: no V binary (cannot locate toolchain dir)')
	if (!isVvmOwned(vbin, root)) {
		throw new Error(
			`vvm ensure-sqlite: ${vbin} is not vvm-managed — install the amalgamation for your system V manually (see https://sqlite.org/download.html)`
		)
	}
	const url = sqliteDownloadUrl()
	const archive = join(tmpdir(), `vvm-sqlite-${Date.now()}.zip`)
	console.log(`vvm: downloading SQLite amalgamation (${url})`)
	await download(url, archive)
	const stage = join(versionsDir(root), `.stage-sqlite-${Date.now()}`)
	rmSync(stage, { recursive: true, force: true })
	mkdirSync(stage, { recursive: true })
	extract(archive, stage)
	flattenSingleDir(stage)
	// `extract` flattens one level already when the zip wraps a single dir;
	// the amalgamation zips wrap `sqlite-amalgamation-*/` — handle both.
	let src = stage
	try {
		const entries = readdirSync(stage, { withFileTypes: true })
		if (entries.length === 1 && entries[0].isDirectory()) src = join(stage, entries[0].name)
	} catch {
		/* use stage as-is */
	}
	rmSync(dir, { recursive: true, force: true })
	mkdirSync(dir, { recursive: true })
	for (const f of ['sqlite3.c', 'sqlite3.h', 'sqlite3ext.h']) {
		const from = join(src, f)
		if (existsSync(from)) {
			const data = readFileSync(from)
			writeFileSync(join(dir, f), data)
		}
	}
	rmSync(stage, { recursive: true, force: true })
	rmSync(archive, { force: true })
	if (!existsSync(join(dir, 'sqlite3.c')) || !existsSync(join(dir, 'sqlite3.h'))) {
		throw new Error(`vvm ensure-sqlite: extraction produced no sqlite3.c/sqlite3.h from ${url}`)
	}
	console.log(`vvm: SQLite amalgamation → ${dir}`)
	return { dir, cached: false }
}

/** Normalize a target arch value (aliases + case-insensitive). */
export function normalizeTargetArchName(raw) {
	const v = String(raw ?? '')
		.trim()
		.toLowerCase()
	if (v === 'amd64' || v === 'x64' || v === 'x86_64' || v === 'x86-64') return 'amd64'
	if (v === 'arm64' || v === 'aarch64') return 'arm64'
	return ''
}

/** zig `-target` triple for a (os, arch) pair. gnu default (musl needs
 *  extra link flags for V's GC backtrace) — boots on debian:stable-slim. */
export function zigTriple(os, arch) {
	const a = arch === 'arm64' ? 'aarch64' : 'x86_64'
	if (os === 'macos') return `${a}-macos`
	if (os === 'windows') return `${a}-windows-gnu`
	return `${a}-linux-gnu`
}

export function zigDir(root = VVM_ROOT) {
	return join(versionsDir(root), 'zig')
}

export function zigBinary(root = VVM_ROOT) {
	return join(zigDir(root), process.platform === 'win32' ? 'zig.exe' : 'zig')
}

export function zigVersionFile(root = VVM_ROOT) {
	return join(zigDir(root), '.zig-version')
}

/** Absolute wrapper path for a target (`zig-cc-<os>-<arch>[.cmd]`). */
export function zigCcWrapperPath(os, arch, root = VVM_ROOT) {
	const ext = process.platform === 'win32' ? '.cmd' : ''
	return join(zigDir(root), `zig-cc-${os}-${arch}${ext}`)
}

export function zigDownloadUrl(version, hostKey) {
	const asset = ZIG_ASSETS[hostKey ?? platformKey()]
	if (!asset) throw new Error(`unsupported platform for zig (${process.platform}/${process.arch})`)
	return `https://ziglang.org/download/${version}/${asset.replace('{v}', version)}`
}

function extractTarball(archive, outDir) {
	mkdirSync(outDir, { recursive: true })
	if (archive.endsWith('.zip')) {
		if (process.platform === 'win32') {
			execFileSync(
				'powershell',
				['-NoProfile', '-Command', `Expand-Archive -Force '${archive}' '${outDir}'`],
				{ stdio: 'inherit' }
			)
		} else {
			execFileSync('unzip', ['-q', '-o', archive, '-d', outDir], { stdio: 'inherit' })
		}
		return
	}
	// .tar.xz — system tar handles it on all three OSes (macOS ships bsdtar).
	execFileSync('tar', ['-xf', archive, '-C', outDir], { stdio: 'inherit' })
}

/** Download + extract zig into versions/zig/ (idempotent unless force). */
export async function ensureZig({
	version = DEFAULT_ZIG_VERSION,
	force = false,
	root = VVM_ROOT,
} = {}) {
	const bin = zigBinary(root)
	const marker = zigVersionFile(root)
	if (
		!force &&
		existsSync(bin) &&
		existsSync(marker) &&
		readFileSync(marker, 'utf8').trim() === version
	) {
		return { bin, cached: true }
	}
	const url = zigDownloadUrl(version)
	const archive = join(tmpdir(), `vvm-zig-${Date.now()}-${url.split('/').pop()}`)
	console.log(`vvm: downloading zig ${version} (${url})`)
	await download(url, archive)
	const stage = join(versionsDir(root), `.stage-zig-${Date.now()}`)
	rmSync(stage, { recursive: true, force: true })
	mkdirSync(stage, { recursive: true })
	extractTarball(archive, stage)
	flattenSingleDir(stage)
	rmSync(zigDir(root), { recursive: true, force: true })
	mkdirSync(versionsDir(root), { recursive: true })
	renameSync(stage, zigDir(root))
	rmSync(archive, { force: true })
	writeFileSync(marker, `${version}\n`)
	if (process.platform !== 'win32') {
		try {
			chmodSync(bin, 0o755)
		} catch {
			/* best effort */
		}
	}
	execFileSync(bin, ['version'], { stdio: ['ignore', 'pipe', 'ignore'] })
	console.log(`vvm: zig ${version} → ${zigDir(root)}`)
	return { bin, cached: false }
}

/** Write the `zig-cc-<os>-<arch>` wrapper forwarding to `zig cc -target`. */
export function writeZigCcWrapper(zigBin, os, arch, { root = VVM_ROOT } = {}) {
	const triple = zigTriple(os, arch)
	const wrapper = zigCcWrapperPath(os, arch, root)
	mkdirSync(dirname(wrapper), { recursive: true })
	if (process.platform === 'win32') {
		writeFileSync(wrapper, `@echo off\r\n"${zigBin}" cc -target ${triple} %*\r\n`)
	} else {
		writeFileSync(wrapper, `#!/bin/sh\nexec "${zigBin}" cc -target ${triple} "$@"\n`)
		try {
			chmodSync(wrapper, 0o755)
		} catch {
			/* best effort */
		}
	}
	return wrapper
}

/** Declared cross targets: explicit args win, then SWELTE_TARGET_OS/ARCH
 *  env, then the closest package.json `swelte.targetOs/targetArch`.
 *  No declaration → [] (prepare becomes a no-op, zig not installed). */
export function declaredTargets({ os, arch } = {}) {
	const envOs = normalizeTargetOsName(process.env.SWELTE_TARGET_OS)
	const envArch = normalizeTargetArchName(process.env.SWELTE_TARGET_ARCH)
	let cfgOs = ''
	let cfgArch = ''
	let dir = process.cwd()
	for (let i = 0; i < 8; i++) {
		const pkg = join(dir, 'package.json')
		if (existsSync(pkg)) {
			try {
				const sw = JSON.parse(readFileSync(pkg, 'utf8')).swelte ?? {}
				cfgOs = normalizeTargetOsName(sw.targetOs)
				cfgArch = normalizeTargetArchName(sw.targetArch)
			} catch {
				/* malformed — ignore */
			}
			break
		}
		const parent = dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	const finalOs = normalizeTargetOsName(os) || envOs || cfgOs
	const finalArch = normalizeTargetArchName(arch) || envArch || cfgArch
	if (!finalOs && !finalArch) return []
	return [{ os: finalOs, arch: finalArch }]
}

/** Host pair in (os, arch) form. */
export function hostPair() {
	const os =
		process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
	const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
	return { os, arch }
}

/** `vvm prepare`: ensure zig + write wrappers for the declared targets
 *  AND the host pair (native builds fall back to the host wrapper when
 *  no system compiler exists — stock Windows/macOS). No args = derive
 *  from SWELTE_TARGET_OS/ARCH or package.json. */
export async function prepareCross({ os, arch, zigVersion, force = false, root = VVM_ROOT } = {}) {
	const explicit = [{ os: normalizeTargetOsName(os), arch: normalizeTargetArchName(arch) }].filter(
		(t) => t.os || t.arch
	)
	const wanted = explicit.length > 0 ? explicit : declaredTargets({})
	const host = hostPair()
	// Always prep the host wrapper too: it is the native-build fallback
	// on compiler-less machines, and a no-op (mtime/cached check) when
	// zig is already installed.
	const pairs = [...wanted.map((t) => ({ os: t.os || host.os, arch: t.arch || host.arch })), host]
	// Dedup by os-arch.
	const seen = new Set()
	const concrete = pairs.filter((t) => {
		const k = `${t.os}-${t.arch}`
		if (seen.has(k)) return false
		seen.add(k)
		return true
	})
	const { bin } = await ensureZig({
		version: zigVersion ?? process.env.SWELTE_ZIG_VERSION ?? DEFAULT_ZIG_VERSION,
		force,
		root,
	})
	const wrappers = concrete.map((t) => {
		const w = writeZigCcWrapper(bin, t.os, t.arch, { root })
		console.log(`vvm prepare: ${t.os}-${t.arch} → ${w} (zig -target ${zigTriple(t.os, t.arch)})`)
		return w
	})
	return { zig: bin, wrappers }
}

function printHelp() {
	console.log(`vvm ${VVM_VERSION} — V Version Manager
Usage: vvm <command> [args]

  install <version> [--force] [--link]   Download + extract V (e.g. vvm install 0.5.2, vvm install latest)
                              Never touches an already-installed system V.
  prepare [--target-os O] [--target-arch A] [--zig-version V] [--force]
                              Ensure zig + write zig-cc-<os>-<arch> wrapper(s).
                              No flags = derive from SWELTE_TARGET_OS/ARCH
                              or package.json swelte.targetOs/targetArch.
  ensure-sqlite [--force]       Ensure the SQLite amalgamation for the active
                              toolchain (db.sqlite headers). Lazy: core calls
                              this only when a build needs it and it is absent.
  use <version>|system [--system]  Switch toolchain: managed version or the
                              already-installed system V (never downloaded).
                              Writes .active-version (+ .active-system-path pin).
  ls | list                     List installed versions (* = active), incl. system V
  uninstall <version>           Remove a managed version (never the active one, never system)
  which                         Print path of the active v binary
  exec <version>|system -- <args...>  Run a one-off command with a given version
  current                       Print active version
  link [--dir D] [--global] [--force]    Expose active V on PATH (default ${defaultLinkDir()}).
                              VSCode's V extension needs a global 'v':
                              this symlinks it to the vvm toolchain.
                              No-op when active is system (already global).
                              Opt-in: nothing links unless you run this
                              (or set VVM_LINK=1 for auto-link on install/use).
  unlink [--dir D] [--global] [--force]  Remove the 'v' entry-point from PATH
  status                        Show active version + system link state
  help                          This help`)
}

function parseLinkArgs(rest) {
	let dir = ''
	let global = false
	let force = false
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i]
		if (a === '--force' || a === '-f') force = true
		else if (a === '--global' || a === '-g') global = true
		else if (a === '--dir' || a === '--link-dir') dir = rest[++i] || ''
		else if (a.startsWith('--dir=')) dir = a.slice('--dir='.length)
		else if (a.startsWith('--link-dir=')) dir = a.slice('--link-dir='.length)
	}
	if (global) dir = process.platform === 'win32' ? defaultLinkDir() : '/usr/local/bin'
	return { dir: dir || undefined, force }
}

function maybeAutoLink() {
	// Opt-in auto-link: VVM_LINK=1 creates/refreshes the system link
	// after install/use of a *managed* version. A pre-existing vvm link is
	// refreshed too — but never toward `system` uninvited (system is global
	// already; the refresh would clobber the managed link).
	if (isSystemActive()) return process.env.VVM_LINK === '1'
	if (process.env.VVM_LINK === '1') return true
	try {
		return linkStatus({}).target !== ''
	} catch {
		return false
	}
}

function reportLink(linkFile) {
	console.log(`vvm: linked ${linkFile} → ${resolveV()}`)
	const pathDirs = String(process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')
	if (!pathDirs.includes(dirname(linkFile))) {
		console.log(
			`vvm: note: ${dirname(linkFile)} is not on PATH — add it so 'v' resolves (VSCode reads PATH on launch)`
		)
		console.log(`  export PATH="${dirname(linkFile)}:$PATH"  # or: vvm link --dir <dir-on-PATH>`)
	}
}

async function main(argv) {
	const [cmd, ...rest] = argv
	if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
		printHelp()
		return
	}
	if (cmd === 'install') {
		const version = normalizeVersion(
			rest.find((a) => !a.startsWith('-')) ||
				process.env.SWELTE_V_VERSION ||
				process.env.SWELTE_V_VERSION ||
				DEFAULT_V_VERSION
		)
		const force = rest.includes('--force') || rest.includes('-f')
		await installVersion(version, { force })
		if (rest.includes('--link') || maybeAutoLink()) reportLink(linkSystemV({}))
		return
	}
	if (cmd === 'prepare') {
		const flag = (name) => {
			const i = rest.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`))
			if (i === -1) return ''
			const eq = rest[i].indexOf('=')
			if (eq !== -1) return rest[i].slice(eq + 1)
			return rest[i + 1] && !rest[i + 1].startsWith('-') ? rest[i + 1] : ''
		}
		const os = flag('target-os')
		const arch = flag('target-arch')
		const zigVersion = flag('zig-version')
		if (os && !normalizeTargetOsName(os)) {
			console.error(`vvm prepare: invalid --target-os '${os}' (want linux|macos|windows)`)
			process.exit(1)
		}
		if (arch && !normalizeTargetArchName(arch)) {
			console.error(`vvm prepare: invalid --target-arch '${arch}' (want amd64|arm64)`)
			process.exit(1)
		}
		const force = rest.includes('--force') || rest.includes('-f')
		await prepareCross({ os, arch, zigVersion: zigVersion || undefined, force })
		return
	}
	if (cmd === 'ensure-sqlite') {
		const force = rest.includes('--force') || rest.includes('-f')
		const bin = resolveV()
		if (!bin) {
			console.error('vvm ensure-sqlite: no V installed (run: vvm install 0.5.2)')
			process.exit(1)
		}
		try {
			await ensureSqlite({ vbin: bin, force })
		} catch (err) {
			console.error(`vvm ensure-sqlite: ${err.message}`)
			process.exit(1)
		}
		return
	}
	if (cmd === 'use') {
		const raw = String(rest[0] || '')
		const wantSystem = raw.trim().toLowerCase() === 'system' || rest.includes('--system')
		if (wantSystem) {
			// Adopt the already-installed system V: never download, never copy —
			// the toolchain stays where the user (or their OS package) put it.
			const info = systemVInfo({})
			if (!info.path) {
				console.error('vvm use: no system `v` on PATH. Install V first, or: vvm install 0.5.2')
				process.exit(1)
			}
			setActiveVersion('system')
			setActiveSystemPath(info.path)
			console.log(`vvm: now using system V ${info.version || '(unknown version)'} (${info.path})`)
			if (rest.includes('--link')) {
				try {
					reportLink(linkSystemV({ force: true }))
				} catch (err) {
					console.error(`vvm: link refresh failed (${err.message})`)
				}
			} else {
				try {
					const st = linkStatus({})
					if (st.target && !st.ok)
						console.log(
							`vvm: note: system link is stale (${st.linkFile} → ${st.target}) — run: vvm link --force`
						)
				} catch {
					/* best-effort */
				}
			}
			return
		}
		let version = normalizeVersion(raw)
		if (!version) {
			console.error('vvm use: missing version (e.g. vvm use 0.5.2)')
			process.exit(1)
		}
		if (version === 'latest') {
			const installed = listInstalled()
			if (installed.length === 0) {
				console.error('vvm use: no versions installed. Run: vvm install latest')
				process.exit(1)
			}
			version = installed[installed.length - 1]
		}
		const bin = vBinary(versionDir(version))
		if (!existsSync(bin)) {
			console.error(`vvm use: ${version} not installed. Run: vvm install ${version}`)
			process.exit(1)
		}
		setActiveVersion(version)
		console.log(`vvm: now using ${version} (${bin})`)
		if (rest.includes('--link') || maybeAutoLink()) reportLink(linkSystemV({}))
		return
	}
	if (cmd === 'ls' || cmd === 'list') {
		const installed = listInstalled()
		const active = activeVersion()
		const sysActive = active.trim().toLowerCase() === 'system'
		if (installed.length === 0) console.log('(no versions installed — run: vvm install 0.5.2)')
		for (const v of installed) console.log(`${!sysActive && v === active ? '*' : ' '} ${v}`)
		// The already-installed system V is a first-class version:
		// listed (never downloaded), usable via `vvm use system`.
		const sys = systemVInfo({})
		if (sys.path) {
			const ver = sys.version ? ` (${sys.version} at ${sys.path})` : ` (at ${sys.path})`
			console.log(`${sysActive ? '*' : ' '} system${ver}`)
		} else if (sysActive) {
			const pinned = activeSystemPath()
			console.log(
				`* system (missing${pinned ? ` — was ${pinned}` : ''} — reinstall V or: vvm use 0.5.2)`
			)
		}
		return
	}
	if (cmd === 'current') {
		console.log(activeVersion() || '(none)')
		return
	}
	if (cmd === 'which') {
		const bin = resolveV()
		if (!bin) {
			if (isSystemActive())
				console.error(
					`vvm which: system V not found${activeSystemPath() ? ` (was ${activeSystemPath()})` : ''} — reinstall V or: vvm use 0.5.2`
				)
			else console.error('vvm which: no V installed (run: vvm install 0.5.2)')
			process.exit(1)
		}
		console.log(bin)
		return
	}
	if (cmd === 'exec') {
		const idx = rest.indexOf('--')
		const rawExec = String(idx === -1 ? rest[0] : rest.slice(0, idx)[0] || '')
		const args = idx === -1 ? [] : rest.slice(idx + 1)
		if (rawExec.trim().toLowerCase() === 'system') {
			// `exec system` runs the already-installed system V — never downloaded.
			const bin = systemVBinary({})
			if (!bin) {
				console.error('vvm exec: no system `v` on PATH')
				process.exit(1)
			}
			execFileSync(bin, args, { stdio: 'inherit' })
			return
		}
		let version = normalizeVersion(rawExec)
		if (version === 'latest') version = activeVersion() || listInstalled().slice(-1)[0] || ''
		if (!version) {
			console.error('vvm exec: usage: vvm exec <version|system> -- <args...>')
			process.exit(1)
		}
		const bin = vBinary(versionDir(version))
		if (!existsSync(bin)) {
			console.error(`vvm exec: ${version} not installed. Run: vvm install ${version}`)
			process.exit(1)
		}
		execFileSync(bin, args, { stdio: 'inherit' })
		return
	}
	if (cmd === 'uninstall' || cmd === 'rm' || cmd === 'remove') {
		const version = normalizeVersion(rest.find((a) => !a.startsWith('-')) || '')
		if (!version) {
			console.error('vvm uninstall: missing version (e.g. vvm uninstall 0.5.2)')
			process.exit(1)
		}
		if (version === 'system') {
			// The system V lives outside vvm — it can be *deselected*, never removed.
			console.error(
				'vvm uninstall: `system` is not vvm-managed — nothing to remove (use: vvm use 0.5.2 to switch away)'
			)
			process.exit(1)
		}
		const active = activeVersion()
		if (active.toLowerCase() === 'system') {
			// System is active: every managed toolchain is just inactive files —
			// allow removing any of them (you can always switch back with `use`).
		} else if (active === version) {
			console.error(
				`vvm uninstall: refusing to remove the active version (${version}) — switch first (vvm use <other>|system)`
			)
			process.exit(1)
		}
		const dir = versionDir(version)
		if (!existsSync(dir)) {
			console.error(`vvm uninstall: ${version} not installed`)
			process.exit(1)
		}
		rmSync(dir, { recursive: true, force: true })
		console.log(`vvm: uninstalled ${version}`)
		return
	}
	if (cmd === 'link') {
		// Active is already the system V: it IS global — nothing to link.
		if (isSystemActive()) {
			const bin = resolveV()
			console.log(
				bin
					? `vvm: already global — system V ${bin} is on PATH, nothing to link`
					: 'vvm: system V not found — reinstall V first'
			)
			if (!bin) process.exit(1)
			return
		}
		const { dir, force } = parseLinkArgs(rest)
		try {
			reportLink(linkSystemV({ dir, force }))
		} catch (err) {
			if (err?.code === 'EACCES' || err?.code === 'EPERM') {
				console.error(
					`vvm link: no write access to ${dir || defaultLinkDir()} — retry with sudo or pick a dir on PATH:`
				)
				console.error(`  sudo vvm link --global # /usr/local/bin (needs root)`)
				console.error(`  vvm link --dir ~/.local/bin # no root needed (add to PATH)`)
			} else console.error(`vvm link: ${err.message}`)
			process.exit(1)
		}
		return
	}
	if (cmd === 'unlink') {
		const { dir, force } = parseLinkArgs(rest)
		try {
			const removed = unlinkSystemV({ dir, force })
			console.log(removed ? `vvm: removed ${removed}` : 'vvm: no link present')
		} catch (err) {
			console.error(`vvm unlink: ${err.message}`)
			process.exit(1)
		}
		return
	}
	if (cmd === 'status') {
		const active = activeVersion() || '(none)'
		const bin = resolveV()
		if (isSystemActive()) {
			console.log(
				`active: system${bin ? ` (${bin})` : ' (missing — reinstall V or: vvm use 0.5.2)'}`
			)
			const st = linkStatus({})
			if (st.target)
				console.log(
					`link: ${st.linkFile} → ${st.target} (redundant — system V is global already; vvm unlink to remove)`
				)
			else console.log('link: none needed (system V is global already)')
			return
		}
		console.log(`active: ${active}${bin ? ` (${bin})` : ''}`)
		const st = linkStatus({})
		if (!st.target) console.log(`link: none (run: vvm link — default ${st.linkFile})`)
		else
			console.log(`link: ${st.linkFile} → ${st.target}${st.ok ? '' : ' (STALE — run: vvm link)'}`)
		return
	}
	console.error(`vvm: unknown command "${cmd}". Run: vvm help`)
	process.exit(1)
}

function isMainModule() {
	try {
		return realpathSync(resolve(process.argv[1] || '')) === realpathSync(join(HERE, 'vvm.js'))
	} catch {
		return false
	}
}
const isMain = isMainModule()
if (isMain) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(`vvm: ${err.message}`)
		process.exit(1)
	})
}
