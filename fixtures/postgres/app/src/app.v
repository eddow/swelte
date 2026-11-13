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
