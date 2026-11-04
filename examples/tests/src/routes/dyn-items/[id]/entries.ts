// Paginated async entries: two pages of one id each (generate-time await).
export async function entries() {
	const out: string[] = []
	for (let page = 1; page <= 2; page++) {
		// Simulated fetch pagination — real code would fetch(`/api?page=${page}`).
		await Promise.resolve()
		out.push(`e2e-${page}`)
	}
	return out
}
