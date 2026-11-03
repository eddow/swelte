// entries() for the members/[id=integer] dynamic leaf — sibling file,
// so the path is members/[id=integer]/entries.ts. Plain strings fill
// the single { id } param for prerender 'all' expansion.
export function entries(): string[] {
	return ['42', '7']
}
