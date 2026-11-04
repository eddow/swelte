// Runs on `npm install @swelte/vvm`: ensures a V toolchain exists under versions/.
// Respects SWELTE_V_VERSION (legacy: SWELTE_V_VERSION, default 0.5.2) and VVM_SKIP_INSTALL=1 to opt out.
// Also runs `vvm prepare` when a cross target is declared (explicit
// SWELTE_TARGET_OS/ARCH env or package.json swelte.targetOs/targetArch) —
// so `npm i` preps the machine for `swelte build --target-os/--target-arch`.
// Opt out of the zig half with VVM_SKIP_ZIG=1.
import { resolveV, installVersion, DEFAULT_V_VERSION, prepareCross } from './vvm.js';

if (process.env.VVM_SKIP_INSTALL === '1') {
  console.log('vvm postinstall: skipped (VVM_SKIP_INSTALL=1).');
  process.exit(0);
}
const existing = resolveV();
if (existing) {
  console.log(`vvm postinstall: V already available (${existing}), skipping download.`);
} else {
  const version = process.env.SWELTE_V_VERSION || process.env.SWELTE_V_VERSION || DEFAULT_V_VERSION;
  console.log(`vvm postinstall: installing V ${version} ...`);
  await installVersion(version);
}
// Cross half: always prep (host wrapper is the native-build fallback on
// compiler-less Windows/macOS; zig download is cached/idempotent).
// Opt out of the zig half with VVM_SKIP_ZIG=1.
if (process.env.VVM_SKIP_ZIG === '1') {
	console.log('vvm postinstall: zig prep skipped (VVM_SKIP_ZIG=1).');
} else {
	await prepareCross({});
}
