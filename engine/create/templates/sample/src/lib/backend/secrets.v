// Backend-only fixture (roadmap §16): secret store, never ships to the browser.
module secrets

pub struct SecretIn {
pub:
	key string
}

@[rpc]
pub fn read_secret(args SecretIn) string {
	return 'secret:' + args.key
}
