// entries() for the posts/[slug=slug] dynamic leaf — sibling file at
// posts/[slug=slug]/entries.ts. Object rows map slug directly.
export function entries(): { slug: string }[] {
	return [{ slug: 'hello' }, { slug: 'world' }]
}
