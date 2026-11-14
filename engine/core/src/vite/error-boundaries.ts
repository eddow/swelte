import type { SvelteRouteEntry } from './types.js'

export interface ErrorBoundary {
	svelte: string
	scope: string
	wrappers: string[]
}

/** Boundaries retain ancestor layouts; the layout in their own directory is
 * replaced too, so a broken layout cannot prevent its boundary from rendering. */
export function collectErrorBoundaries(entries: SvelteRouteEntry[]): ErrorBoundary[] {
	const dir = (file: string) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '')
	return entries
		.filter((entry) => entry.kind === 'error')
		.map((entry) => {
			const scope = dir(entry.svelte)
			return {
				svelte: entry.svelte,
				scope,
				wrappers: entries
					.filter((wrapper) => {
						const parent = dir(wrapper.svelte)
						return (
							wrapper.kind === 'wrapper' &&
							scope !== parent &&
							(parent === '' || scope.startsWith(`${parent}/`))
						)
					})
					.map((wrapper) => wrapper.svelte)
					.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)),
			}
		})
}

/** Self-contained because its compiled JS is embedded in both router bundles.
 * Known pages use physical ancestry (including groups). Unknown URLs use only
 * ungrouped scopes, avoiding arbitrary selection between group siblings. */
export function selectErrorBoundaries(
	boundaries: ErrorBoundary[],
	mod: string | null,
	pathname: string
): ErrorBoundary[] {
	const physical = mod?.replace(/^\.\//, '')
	const directory = physical?.includes('/') ? physical.slice(0, physical.lastIndexOf('/')) : ''
	const segments = pathname.split(/[?#]/)[0].split('/').filter(Boolean)
	return boundaries
		.filter(({ scope }) => {
			if (!scope) return true
			if (physical) return directory === scope || directory.startsWith(`${scope}/`)
			const pattern = scope.split('/')
			if (pattern.some((part) => part.startsWith('('))) return false
			return pattern.every((part, index) => {
				if (part.startsWith('[...')) return true
				if (part.startsWith('[')) return segments[index] !== undefined
				return part === segments[index]
			})
		})
		.sort(
			(a, b) =>
				b.scope.split('/').length - a.scope.split('/').length || b.scope.length - a.scope.length
		)
}

export function errorBoundaryProps(
	envelope: {
		levels?: Record<string, Record<string, unknown>>
		params?: Record<string, string>
		compat?: boolean
		form?: unknown
	} | null,
	mod: string,
	error: { status: number; message: string },
	leaf: boolean
): Record<string, unknown> {
	if (leaf) return error
	let data = envelope?.levels?.[mod]
	if (data === undefined) {
		data = {}
		for (const [name, value] of Object.entries(envelope?.levels ?? {})) {
			if (name === '+route' || (name.endsWith('/+route') && mod.startsWith(name.slice(0, -6))))
				data = value
		}
	}
	return envelope?.compat
		? { params: envelope.params ?? {}, data, form: envelope.form ?? null }
		: { params: envelope?.params ?? {}, ...data, form: envelope?.form ?? null }
}
