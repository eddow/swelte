// The shell is inherently client-only: it opens WebSockets, holds live SSE
// streams and keeps in-memory approval state — none of which SSR-renders
// into anything meaningful. Opt out of sync renderRoute: Hand serves the
// SPA shell and everything below resolves in the browser.
export const ssr = false
