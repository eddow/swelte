// Async universal load for `/router/live` — §1 streaming twin.
// The sibling ssr flag opts OUT of sync renderRoute:
// Hand skips QJS/sidecar (swelte_no_ssr), serves the SPA shell,
// and this async load resolves client-side. SSR-on routes must stay
// sync (assertUniversalLoadSync rejects async/await/fetch there).
//
// NOTE: typed TS — excluded from the sync bundle anyway (client-only),
// and transpile-covered if ever bundled.
export const ssr = false

export async function load({ params }: { params: Record<string, string> }) {
	const tick = await Promise.resolve('live')
	return {
		liveTag: `async:${tick}`,
		paramsEcho: JSON.stringify(params),
	}
}
