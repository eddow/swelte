// Parity fixtures: P1 item 7 (@[error] sanitizer) + reroute hook.
// @[error] replaces every error message before it reaches the client;
// @[reroute] rewrites /old-parity to / before dispatch.
module app

@[error]
pub fn sanitize(message string, status int) string {
	_ = status
	if message == '' {
		return 'safe-error'
	}
	return 'safe:' + message
}

@[reroute]
pub fn rewrite(host string, path string) string {
	_ = host
	if path == '/old-parity' {
		return '/'
	}
	return ''
}
