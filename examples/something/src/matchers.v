// Item 7: custom param matcher — portable subset only
// (for c in s.bytes(), byte compares, early returns; no time/os/net
// imports). Used by posts/[slug=slug].v: lowercase ASCII letters.
module matchers

@[matcher]
pub fn slug(s string) bool {
	if s == '' {
		return false
	}
	for c in s.bytes() {
		if c < 97 || c > 122 {
			return false
		}
	}
	return true
}
