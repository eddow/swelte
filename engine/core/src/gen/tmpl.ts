// Shared codegen template helpers: the `v` tagged-template + `list`.
// `v` concatenates literal parts with interpolated values; arrays are
// joined (codegen emits string[]), null/undefined become ''. Using real
// template literals lets emitters hold verbatim V/JS/TS (tabs, quotes)
// instead of per-line `o.push` with escaping.
//
// NOTE: cooked strings (default tag semantics). A literal backslash in
// the emitted output must be written doubled in the template source
// (source `\\` cooks to output `\`). This mirrors what the old
// `o.push('...\\t...')` lines did, minus the per-line overhead.
export function v(ss: TemplateStringsArray, ...values: unknown[]): string {
	return ss.reduce((result: string, str: string, i: number) => {
		const val = values[i] as unknown
		const rendered = Array.isArray(val) ? val.join('') : (val ?? '')
		return result + str + rendered
	}, '')
}

/** Join a mapped collection without separators (inline loops in templates). */
export function list<T>(collection: readonly T[], fn: (item: T, i: number) => unknown): string {
	return collection.map(fn).join('')
}
