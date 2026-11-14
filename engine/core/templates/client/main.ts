// Swelte client entry (engine-owned source of truth).
// generate() renders this plus user-setup imports into `.swelte/entry-main.ts`
// (same pattern as `templates/harness/server.v` → `.swelte/server.v`):
// renderClientEntry prepends `import '../src/app.js'` when src/app.ts exists
// (legacy src/client.ts fallback), plus `import '../src/app.css'` when the
// stylesheet exists — all `.js`/extensionless-safe specifiers, so user `tsc`
// stays clean without `allowImportingTsExtensions`.
// Route through `.swelte/routes.js` so +route.svelte wrappers nest
// automatically (no manual import in +page.svelte).
// SSR: hydrate when Hand filled the SSR body marker, else mount the SPA shell.
// Then boot the §1.4 client router (goto/preloadData/pushState + guards).
// The SDK bridge (`globalThis.__swelteRouterSdk`) is wired by the app
// bundle; the side-effect SDK import ensures it exists before hydration.
import { hydrateSwelteRoute, mountSwelteRoute, initSwelteRouter, preloadData, setError } from './routes.js'
import '@swelte/core'

const target = document.getElementById('app')!
async function __swelteBoot() {
	const url = location.pathname + location.search + location.hash
	const serialized = document.getElementById('__swelte_page')?.textContent
	let initial: unknown
	if (serialized) {
		const parsed = JSON.parse(serialized)
		if (parsed.version !== 1 || !parsed.route || !parsed.params) throw new Error('swelte: invalid initial page envelope')
		parsed.url = location.href
		initial = parsed
	} else {
		initial = (await preloadData(url))?.data ?? undefined
	}
	if (target.dataset.swelteSsr === '1' || target.childNodes.length > 0) {
		await hydrateSwelteRoute(target, url, initial)
	} else {
		await mountSwelteRoute(target, url, initial)
	}
	initSwelteRouter(target)
}
__swelteBoot().catch((e) => {
	if ((globalThis as { __swelteStrictHydration?: boolean }).__swelteStrictHydration) throw e
	console.error('[swelte] page boot failed', e)
	initSwelteRouter(target)
	return setError({ status: 500, message: 'page load failed' })
})
