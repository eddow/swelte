// `@swelte/ai/media` — Phase D placeholder. Composes `@swelte/ai` with the
// optional `@swelte/media` package. Not implemented yet; importing it throws
// so media code paths fail loudly instead of silently degrading.
export * from './boundary.js'

export function assertMediaReady(): never {
	throw new Error('@swelte/ai/media is not implemented yet (roadmap Phase D)')
}
