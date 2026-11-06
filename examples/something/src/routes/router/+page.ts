// Universal sibling load for `/router` — §1 sync view-model transform.
// Runs INSIDE sync renderRoute before render (SSR-on); return merges
// into the leaf props. Sync-only while SSR is on: no fetch/await/node:,
// no #routes/#lib/@swelte/core imports (build errors — move fetches to
// @[load] in the .v). Async is allowed only with the ssr=false flag.
//
// NOTE: typed TS — ssr-qjs transpiles the sibling (`transpileSiblingLoad`,
// the mirror of the `.svelte` generate:'server' preprocessing step) so
// annotations never reach the QJS bundle.
export function load({
	params,
	props,
	url,
}: {
	params: Record<string, string>
	props: Record<string, unknown>
	url: string
}) {
	return {
		viewModel: `universal:${String((props as { greeting?: string }).greeting ?? 'none')}`,
		paramsEcho: JSON.stringify(params),
		urlEcho: url,
	}
}
