module home

import npm_swelte_dogfood_sample_lib.runner
import time
import os

pub struct Probe {
pub:
	message string
	digest string
}

pub struct PageData {
pub:
	message string
	search string
	locale string
}

fn snapshot() !Probe {
	store := runner.MemoryStore{prefix: 'saved:'}
	message := runner.run(store, ' hello ', fn (message string) bool {
		return message.len > 0
	})!
	// Cancellation must remain a native error, not disappear at packaging.
	runner.run(store, 'ignored', fn (_ string) bool { return false }) or {
		if err.msg() != 'subscriber cancelled' {
			return err
		}
		return Probe{message, runner.digest('hello')}
	}
	return error('expected subscriber cancellation')
}

@[get]
pub fn probe(req SwelteRequest) !Probe {
	return snapshot()
}

@[load]
pub fn load_home(req SwelteRequest, parent Route_LayoutData) !PageData {
	search := req.query['q'] or { '' }
	if search == 'slow' { time.sleep(250 * time.millisecond) }
	if search == 'timeout' { time.sleep(1200 * time.millisecond) }
	if search == 'drain' || search == 'stuck' {
		os.write_file('load-started', 'yes')!
		time.sleep(if search == 'stuck' { 2000 * time.millisecond } else { 1200 * time.millisecond })
		os.write_file('load-finished', 'yes')!
	}
	if search == 'load-fail' { return swelte_error(403, 'page denied') }
	if search == 'private-load' { return error('private database detail') }
	value := snapshot()!
	return PageData{value.message, req.query['q'] or { '' }, parent.locale}
}

@[post('save')]
pub fn save(req SwelteRequest) SwelteResponse {
	if req.form['title'] == 'slow' { time.sleep(250 * time.millisecond) }
	if req.form['title'] == 'explode' { return SwelteResponse{status: 500, body: '{"message":"action unavailable"}'} }
	if req.form['title'] == '' { return SwelteResponse{status: 422, body: '{"fieldErrors":{"title":"required"}}'} }
	return SwelteResponse{body: '{"saved":true}'}
}

@[post('upload')]
pub fn upload(req SwelteRequest) SwelteResponse {
	if req.form['title'] != 'multipart' || req.files.len != 1 { return SwelteResponse{status: 422, body: '{"fieldErrors":{"title":"multipart missing"}}'} }
	bytes := req.files_bytes['attachment'] or { []u8{} }
	if bytes != [u8(0), 1, 2, 255] { return SwelteResponse{status: 422, body: '{"fieldErrors":{"title":"binary mismatch"}}'} }
	return SwelteResponse{body: '{"saved":true,"uploaded":true}'}
}
