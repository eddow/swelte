module cached

import os

pub struct CachedData {
pub:
	value string
}

@[load]
pub fn load_cache(req SwelteRequest, parent Route_LayoutData) !CachedData {
	if os.exists('isr-fail') { return swelte_error(503, 'regeneration failed') }
	return CachedData{os.read_file('isr-value') or { 'initial' }}
}
