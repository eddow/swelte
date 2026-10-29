// Swelte route handler for `/`. Named fns importable from `#routes/index.v`.
module index

pub struct GetGreetingArgs {
pub:
	payload string
}

pub struct SaveNameArgs {
pub:
	payload string
}

@[get]
pub fn get_greeting(args GetGreetingArgs) string {
	return 'Hello, ' + args.payload + '!'
}

@[post]
pub fn save_name(args SaveNameArgs) string {
	return 'saved:' + args.payload
}
