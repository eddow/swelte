// Phase A: package boundary marker. Media types live here as structural
// contracts only — this module never imports (statically or dynamically)
// `@swelte/media`, so an AI-only install carries no media dependency.
// Concrete integration lands in `./media.js` (Phase D).
export interface MediaTrackRef {
	trackId: string
	kind: 'audio' | 'video' | 'sensor'
}

export interface MediaAssetRef {
	assetId: string
	mediaType: string
	expiresAt?: number
}

/** Type-only media event payload; encoded by the media entry point. */
export type MediaEventPayload = { track: MediaTrackRef } | { asset: MediaAssetRef }

export function isTrackPayload(p: MediaEventPayload): p is { track: MediaTrackRef } {
	return 'track' in p
}
