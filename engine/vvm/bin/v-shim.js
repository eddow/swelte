#!/usr/bin/env node
// `v` shim — npm bin-links this as node_modules/.bin/v.
// Forwards to the vvm-managed V binary (active version, or newest installed).
import { execFileSync } from 'node:child_process'
import { resolveV, VVM_ROOT } from './vvm.js'

// When bin-linked, the real package lives at ../../.. relative to .bin —
// but the shim file itself resolves to the package, so VVM_ROOT is authoritative.
const bin = resolveV(process.env.VVM_ROOT ? resolve(process.env.VVM_ROOT) : VVM_ROOT)
if (!bin) {
	console.error('v (vvm shim): no V toolchain installed. Run: vvm install 0.5.2')
	process.exit(1)
}
try {
	execFileSync(bin, process.argv.slice(2), { stdio: 'inherit' })
} catch (err) {
	process.exit(err.status ?? 1)
}
