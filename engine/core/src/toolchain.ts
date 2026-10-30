// Shared toolchain resolution (V binary via PATH or @swelte/vvm).
import { execFileSync, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function whichV(): string {
	try {
		const probe = process.platform === 'win32' ? 'where' : 'which'
		return (
			execSync(`${probe} v`, { stdio: ['ignore', 'pipe', 'ignore'] })
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
		return execFileSync(vbin, ['version']).toString().trim()
	} catch {
		return '(not found — run `vvm install 0.5.2`)'
	}
}
