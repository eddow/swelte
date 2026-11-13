// Read only the current render's public envelope. Each native render has its
// own QJS runtime; replacing the envelope also isolates sequential dev renders.
const current = () => globalThis.__swelteSsrPage ?? {}
function urlView(href) {
	if (typeof URL !== 'undefined') return new URL(href, 'http://localhost')
	const match = /^(\w+:)\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(href) ?? []
	const search = match[4] ?? ''
	const decode = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')) } catch { return s } }
	const pairs = search.slice(1).split('&').filter(Boolean).map((p) => {
		const at = p.indexOf('=')
		return [decode(at < 0 ? p : p.slice(0, at)), decode(at < 0 ? '' : p.slice(at + 1))]
	})
	const host = match[2] ?? 'localhost'
	return {
		href, protocol: match[1] ?? 'http:', host, hostname: host.split(':')[0],
		port: host.split(':')[1] ?? '', origin: (match[1] ?? 'http:') + '//' + host,
		pathname: match[3] || '/', search, hash: match[5] ?? '',
		searchParams: {
			get: (name) => pairs.find(([key]) => key === name)?.[1] ?? null,
			getAll: (name) => pairs.filter(([key]) => key === name).map(([, value]) => value),
			has: (name) => pairs.some(([key]) => key === name),
			entries: () => pairs[Symbol.iterator](),
			toString: () => search.slice(1),
			[Symbol.iterator]: () => pairs[Symbol.iterator](),
		},
		toString: () => href,
	}
}
function read(key) {
	const state = current()
	if (key === 'url') return urlView(state.url ?? 'http://localhost/')
	if (key === 'data') return state.data ?? {}
	if (key === 'route') return state.route ?? { id: null, pattern: null }
	if (key === 'params') return state.params ?? {}
	return state[key] ?? null
}
export const page = new Proxy({}, { get(_, key) {
	if (key === 'subscribe') return (fn) => { fn({ ...current(), url: read('url').pathname + read('url').search, route: read('route').id }); return () => {} }
	if (key === 'get') return () => current()
	return read(key)
} })
export const navigating = { subscribe(fn) { fn(null); return () => {} } }
export const updated = { subscribe(fn) { fn(false); return () => {} } }
