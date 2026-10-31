// Swelte client entry (engine-owned source of truth).
// generate() renders this verbatim into `.swelte/entry-main.ts`
// (same pattern as `templates/harness/server.v` → `.swelte/server.v`).
// Route through `.swelte/routes.js` so +route.svelte wrappers nest
// automatically (no manual import in +page.svelte).
// SSR: hydrate when Hand filled the SSR body marker, else mount the SPA shell.
import { hydrateSwelteRoute, mountSwelteRoute } from './routes.js'

const target = document.getElementById('app')!
if (target.dataset.swelteSsr === '1' || target.childNodes.length > 0) {
	hydrateSwelteRoute(target, location.pathname)
} else {
	mountSwelteRoute(target, location.pathname)
}
