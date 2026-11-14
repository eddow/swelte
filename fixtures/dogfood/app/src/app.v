module app

import os
import time
import backend
import json

@[startup]
pub fn initialize() ! {
	if os.getenv('SWELTE_TEST_STARTUP_FAIL') == '1' { return error('intentional startup failure') }
	os.write_file('app-started', 'ready')!
}

@[cron('1s')]
pub fn background_tick() ! {
	if os.getenv('SWELTE_TEST_JOB_FAIL') == '1' { return error('private job detail') }
	os.write_file('cron-started', 'yes') or {}
	if os.getenv('SWELTE_TEST_SLOW_JOB') == '1' {
		time.sleep(350 * time.millisecond)
		os.write_file('cron-finished', 'yes') or {}
	}
}

@[report]
pub fn observe(entry SwelteReport) ! {
	if entry.path == '/report-fail' { return error('private reporter detail') }
	if entry.phase == 'job-error' { os.write_file('job-report', entry.message)! }
	if entry.request_id != '' { os.write_file('report-' + entry.request_id + '-' + entry.phase, json.encode(entry))! }
}

@[shutdown]
pub fn cleanup() ! {
	if os.exists('load-started') && !os.exists('load-finished') { return error('cleanup raced native load') }
	if os.exists('cron-started') && os.getenv('SWELTE_TEST_SLOW_JOB') == '1' && !os.exists('cron-finished') { return error('cleanup raced cron') }
	if backend.hub_listeners('shutdown-room') != 0 || backend.hub_listeners('shutdown-socket') != 0 { return error('room subscriptions leaked') }
	if os.getenv('SWELTE_TEST_ASSERT_SINGLE_CLEANUP') == '1' && os.exists('shutdown-hook') { return error('duplicate cleanup') }
	if os.getenv('SWELTE_TEST_SLOW_CLEANUP') == '1' { time.sleep(2000 * time.millisecond) }
	os.write_file('shutdown-hook', 'complete')!
}
