// Shared toolchain resolution (V binary via PATH or @swelte/vvm).
import { execFileSync, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** Absolute system C compiler, preferring /usr/bin/* so PATH shadowing can't win. */
export function resolveCC(): string {
	for (const abs of ['/usr/bin/gcc', '/bin/gcc', '/usr/bin/cc', '/bin/cc', '/usr/bin/clang']) {
		if (existsSync(abs)) return abs
	}
	return 'gcc'
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
