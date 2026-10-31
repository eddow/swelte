// Swelte client entry: route through .swelte/routes.js so +route.svelte
// wrappers nest automatically (no manual import in +page.svelte).
import { mountSwelteRoute } from '../.swelte/routes.js'

mountSwelteRoute(document.getElementById('app')!, location.pathname)
