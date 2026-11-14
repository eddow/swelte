module stream

import os
import time

@[post]
pub fn start(req SwelteRequest) !SwelteResponse {
	if req.raw_body.len == 0 { return swelte_error(400, 'body required') }
	mode := req.query['mode'] or { '' }
	if mode == 'fail-before' { return swelte_error(409, 'before stream') }
	return swelte_stream({'Content-Type': 'text/event-stream', 'X-Dogfood-Run-Id': 'fixture-run'}, fn [mode] (stream SwelteStream) ! {
		frame := 'event: delta\ndata: {"text":"hé🙂"}\n\n'.bytes()
		if !stream.write(frame[..31]) || !stream.write(frame[31..33]) || !stream.write(frame[33..]) { return }
		if mode == 'fail-after' { return error('producer failed') }
		if mode == 'cancel' {
			defer { os.write_file('stream-cancelled', 'released') or {} }
			for _ in 0 .. 10000 {
				if !stream.write([]u8{len: 65536, init: u8(120)}) { return }
			}
			return
		}
		if mode == 'idle' {
			select {
				_ := <-stream.cancelled { os.write_file('stream-idle-ended', 'released')! }
				3 * time.second { return error('transport did not cancel idle subscriber') }
			}
			return
		}
		time.sleep(200 * time.millisecond)
		stream.write('event: done\ndata: {}\n\n'.bytes())
	})
}
