// QJS-safe substitute for svelte internal render-context.
// Upstream keeps an AsyncLocalStorage via a lazy node import for async
// renders. Sync renders (our entire SSR surface — pure-sync, no
// streaming, no await) flow through get_render_context only in hydratable
// paths that sync render touches at renderer.js:866. This stub provides
// a module-local context so sync renders work without ALS.
// Async entry points throw — streaming SSR is a non-goal.
// Re-verify against upstream on svelte upgrades.
let context = null

export function get_render_context() {
	if (!context) {
		context = {
			hydratable: { lookup: new Map(), comparisons: [], unresolved_promises: new Map() },
		}
	}
	return context
}

export async function with_render_context(_fn) {
	throw new Error('[swelte:ssr-qjs] async render context unavailable in QuickJS')
}

export function init_render_context() {
	return Promise.resolve()
}
