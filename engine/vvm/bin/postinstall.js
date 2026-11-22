// Runs on `npm install @swelte/vvm`: ensures a V toolchain exists under versions/.
// Respects SWELTE_V_VERSION (default 0.5.2) and VVM_SKIP_INSTALL=1 to opt out.
// Also runs `vvm prepare` when a cross target is declared (explicit
// SWELTE_TARGET_OS/ARCH env or package.json swelte.targetOs/targetArch) —
// so `npm i` preps the machine for `swelte build --target-os/--target-arch`.
// Opt out of the zig half with VVM_SKIP_ZIG=1.
//
// System link (VSCode's V extension wants a global `v`): opt-in via
// VVM_LINK=1 (or VVM_LINK_DIR to pick the dir, default ~/.local/bin).
// Opt out with VVM_LINK=0. Never links by default — vvm keeps the
// toolchain inside node_modules unless you ask.
import {
	DEFAULT_V_VERSION,
	installVersion,
	isSystemActive,
	linkStatus,
	linkSystemV,
	prepareCross,
	resolveV,
} from './vvm.js'

if (process.env.VVM_SKIP_INSTALL === '1') {
	console.log('vvm postinstall: skipped (VVM_SKIP_INSTALL=1).')
	process.exit(0)
}
// An adopted system V is a first-class version: already installed,
// never downloaded, never touched. Respect the choice outright.
if (isSystemActive()) {
	const bin = resolveV()
	if (bin) console.log(`vvm postinstall: using system V (${bin}), skipping download.`)
	else
		console.log(
			'vvm postinstall: system V active but not found — reinstall V or run: vvm use 0.5.2'
		)
} else {
	const existing = resolveV()
	if (existing) {
		console.log(`vvm postinstall: V already available (${existing}), skipping download.`)
	} else {
		const version = process.env.SWELTE_V_VERSION || DEFAULT_V_VERSION
		console.log(`vvm postinstall: installing V ${version} ...`)
		await installVersion(version)
	}
}
// Cross half: always prep (host wrapper is the native-build fallback on
// compiler-less Windows/macOS; zig download is cached/idempotent).
// Opt out of the zig half with VVM_SKIP_ZIG=1.
if (process.env.VVM_SKIP_ZIG === '1') {
	console.log('vvm postinstall: zig prep skipped (VVM_SKIP_ZIG=1).')
} else {
	await prepareCross({})
}
// System half: only when asked (VVM_LINK=1), or refresh a stale link the
// user previously created with `vvm link` (version switch on reinstall).
// Never refresh toward a system V on its own: system is global already,
// and the pin may point at a toolchain that no longer exists.
if (process.env.VVM_LINK === '1') {
	try {
		const linkFile = linkSystemV({})
		console.log(`vvm postinstall: linked ${linkFile} → ${resolveV()} (VSCode sees a global v)`)
	} catch (err) {
		console.log(`vvm postinstall: link skipped (${err.message})`)
	}
} else if (process.env.VVM_LINK !== '0' && !isSystemActive()) {
	try {
		const st = linkStatus({})
		if (st.target && !st.ok) {
			const linkFile = linkSystemV({})
			console.log(`vvm postinstall: refreshed stale link ${linkFile} → ${resolveV()}`)
		}
	} catch {
		/* stale link refresh is best-effort — never fail install */
	}
}
