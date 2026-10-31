// QJS-safe substitute for svelte internal server crypto.
// Upstream uses globalThis.crypto.subtle when available and falls back
// to a lazy node import otherwise. QJS has neither — but the only
// caller is the CSP-hash branch (options.csp.hash), which the SSR
// adapter never enables. This stub throws if that branch is ever hit,
// keeping the bundle free of node imports. Re-verify against upstream
// on svelte upgrades: the file is svelte internal server crypto.
export async function sha256(_data) {
	throw new Error('[swelte:ssr-qjs] sha256 unavailable in QuickJS (CSP hashing not supported in SSR render)')
}

export function base64_encode(bytes) {
	let binary = ''
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i])
	}
	// btoa exists in QuickJS; Buffer does not — always use the loop above.
	return btoa(binary)
}
