// Swelte client entry (sandbox): route through .swelte/routes.js so
// +route.svelte wrappers nest automatically (no manual import in +page.svelte).
// SSR: hydrate when Hand filled <!--ssr-body-->, else mount the SPA shell.
// The generated .swelte/entry-main.ts (from templates/client/main.ts) will
// replace this file once promoted — same logic, engine-owned.
import { hydrateSwelteRoute, mountSwelteRoute } from '../.swelte/routes.js'

const target = document.getElementById('app')!
if (target.dataset.swelteSsr === '1' || target.childNodes.length > 0) {
	hydrateSwelteRoute(target, location.pathname)
} else {
	mountSwelteRoute(target, location.pathname)
}
