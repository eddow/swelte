module app

import backend
import os

@[startup]
pub fn initialize() ! {
	backend.initialize_database()!
	// Represents enabling dependent background work. Migration failure must
	// abort startup before this statement or the server listener is reached.
	os.write_file('dependent-job-started', 'ready')!
}

@[shutdown]
pub fn cleanup() ! {
	if os.exists('load-started') && !os.exists('load-finished') { return error('cleanup raced native load') }
	backend.close_database()!
	os.write_file('shutdown-hook', 'complete')!
}
