// Runs on `npm install @swelte/vvm`: ensures a V toolchain exists under versions/.
// Respects SWELTE_V_VERSION (legacy: SWELTE_V_VERSION, default 0.5.2) and VVM_SKIP_INSTALL=1 to opt out.
import { resolveV, installVersion, DEFAULT_V_VERSION } from './vvm.js';

if (process.env.VVM_SKIP_INSTALL === '1') {
  console.log('vvm postinstall: skipped (VVM_SKIP_INSTALL=1).');
  process.exit(0);
}
const existing = resolveV();
if (existing) {
  console.log(`vvm postinstall: V already available (${existing}), skipping download.`);
  process.exit(0);
}
const version = process.env.SWELTE_V_VERSION || process.env.SWELTE_V_VERSION || DEFAULT_V_VERSION;
console.log(`vvm postinstall: installing V ${version} ...`);
await installVersion(version);
