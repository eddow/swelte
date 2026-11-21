// Library dogfood route for `/`: exercises the public src/lib surface
// (envelope + capability selection + deterministic run) exactly like a
// consumer would. Never published.
module ai_dogfood

@[get]
pub fn probe() string {
	return 'ai dogfood'
}
