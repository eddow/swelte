import { readFileSync, writeFileSync } from 'node:fs'

export function list<T>(collection: readonly T[], fn: (item: T, i: number) => unknown): string {
	return collection.map(fn).join('')
}

// Write only when bytes differ (HMR hygiene): every generate() rewrites
// ~20 files under .swelte/, and Vite HMR watches several of them
// (routes.js, entry-main.ts) plus the .v dispatcher files feed the plugin's
// own regen filter. Unconditional writes bump mtimes on identical content —
// phantom HMR updates, page reloads, and (via .swelte/routes/*.v events
// re-entering regen) a self-sustaining generate loop. Compare-then-write
// keeps mtimes stable when nothing changed.
export function writeIfChanged(file: string, content: string): boolean {
	let prev: string | null = null
	try {
		prev = readFileSync(file, 'utf8')
	} catch {
		/* missing — write it */
	}
	if (prev === content) return false
	writeFileSync(file, content)
	return true
}
