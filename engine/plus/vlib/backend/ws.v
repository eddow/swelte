// WebSocket frames + upgrade (future.md #3): RFC 6455 over a hijacked veb
// conn. Server frames are unmasked; client frames MUST be masked (browsers
// always mask). Only text frames surface: ping → auto-pong, close → clean
// shutdown, continuation → assembled, binary/reserved → protocol-error
// close. The harness performs the HTTP→WS upgrade handshake, then pumps
// frames BOTH ways: hub → socket (outgoing) and socket → route fn
// (incoming, via the fn's receive loop).
module backend

import crypto.sha1
import encoding.base64
import net

// Compute Sec-WebSocket-Accept for a client key (RFC 6455 §1.3).
pub fn ws_accept_key(key string) string {
	guid := '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
	hash := sha1.sum((key.trim_space() + guid).bytes())
	defer {
		unsafe { hash.free() }
	}
	return base64.encode(hash)
}

// Write one server→client text frame (unmasked, FIN set). Payloads up to
// 64KB (16-bit extended length); larger are a route error.
pub fn ws_write_text(mut conn net.TcpConn, msg string) ! {
	b := msg.bytes()
	mut hdr := []u8{}
	hdr << u8(0x81)
	if b.len < 126 {
		hdr << u8(b.len)
	} else if b.len < 65536 {
		hdr << u8(126)
		hdr << u8((b.len >> 8) & 0xff)
		hdr << u8(b.len & 0xff)
	} else {
		return error('ws frame too large (64KB cap)')
	}
	conn.write(hdr)!
	if b.len > 0 {
		conn.write(b)!
	}
}

// Read one client→server frame with the conn's read timeout. Returns
// (payload, alive): alive=false means the socket is done (close frame,
// clean EOF, timeout-without-data is NOT fatal — returns ('', true) so
// the pump keeps polling for hub messages). Fatal framing errors close.
pub fn ws_read_frame_timeout(mut conn net.TcpConn) !(string, bool) {
	msg, alive := ws_read_frame_raw(mut conn) or {
		// Timeouts surface as errors from the C layer; distinguish by
		// message. A timeout is idle, not death — keep the socket.
		if err.msg().contains('timeout') || err.msg().contains('timed out') {
			return '', true
		}
		return '', false
	}
	return msg, alive
}

// Raw frame read (blocking per the conn's timeout). See ws_read_frame.
// Timeout errors PROPAGATE as errors (message keeps 'timeout') so the
// outer ws_read_frame_timeout can map idle → ('', true). Any `or` here
// that returns ('', false) would conflate idle with death and kill
// the pump on the first 100ms idle — the echo-killer.
fn ws_read_frame_raw(mut conn net.TcpConn) !(string, bool) {
	mut hb := []u8{len: 2}
	mut got := 0
	for got < 2 {
		n := conn.read(mut hb[got..]) or {
			// Idle ONLY when zero bytes of a new frame arrived. After a
			// partial header any timeout is fatal (else the next read
			// would misparse the remainder as a new header).
			if got == 0 && (err.msg().contains('timeout') || err.msg().contains('timed out')) {
				return error('ws timeout: ' + err.msg())
			}
			return '', false
		}
		if n == 0 {
			return '', false
		}
		got += n
	}
	masked := hb[1] & 0x80 != 0
	mut paylen := int(hb[1] & 0x7f)
	if paylen == 126 {
		mut ext := []u8{len: 2}
		mut g2 := 0
		for g2 < 2 {
			// Mid-frame: header already consumed, so ANY timeout here
			// is fatal (idle-retry would misparse the remainder).
			n := conn.read(mut ext[g2..]) or { return '', false }
			if n == 0 {
				return '', false
			}
			g2 += n
		}
		paylen = int(ext[0]) * 256 + int(ext[1])
	} else if paylen == 127 {
		return '', false
	}
	mut mask := []u8{len: 4}
	if masked {
		mut g4 := 0
		for g4 < 4 {
			// Mid-frame: header/ext already consumed → always fatal.
			n := conn.read(mut mask[g4..]) or { return '', false }
			if n == 0 {
				return '', false
			}
			g4 += n
		}
	} else {
		ws_write_close(mut conn, 1002, 'client frames must be masked') or {}
		return '', false
	}
	mut payload := ws_read_bytes(mut conn, paylen) or { return '', false }
	for i in 0 .. paylen {
		payload[i] ^= mask[i % 4]
	}
	op := hb[0] & 0x0f
	fin := hb[0] & 0x80 != 0
	if op == 0x8 {
		ws_write_close(mut conn, 1000, '') or {}
		return '', false
	}
	if op == 0x9 {
		ws_write_pong(mut conn, payload) or {}
		return ws_read_frame_raw(mut conn)
	}
	if op == 0xa {
		return ws_read_frame_raw(mut conn)
	}
	if op == 0x2 {
		ws_write_close(mut conn, 1003, 'binary frames unsupported (text only)') or {}
		return '', false
	}
	if op != 0x0 && op != 0x1 {
		ws_write_close(mut conn, 1002, 'reserved opcode') or {}
		return '', false
	}
	if !fin {
		mut full := payload.clone()
		for {
			cop, cfin, cpay := ws_read_frag(mut conn) or { return '', false }
			if cop == 0x8 {
				ws_write_close(mut conn, 1000, '') or {}
				return '', false
			}
			if cop == 0x9 {
				ws_write_pong(mut conn, cpay) or {}
				continue
			}
			if cop != 0x0 {
				ws_write_close(mut conn, 1002, 'expected continuation') or {}
				return '', false
			}
			full << cpay
			if cfin {
				break
			}
		}
		return full.bytestr(), true
	}
	return payload.bytestr(), true
}

fn ws_read_bytes(mut conn net.TcpConn, n int) ![]u8 {
	mut buf := []u8{len: n}
	mut got := 0
	for got < n {
		r := conn.read(mut buf[got..]) or { return error('ws eof') }
		if r == 0 {
			return error('ws eof')
		}
		got += r
	}
	return buf
}

fn ws_read_frag(mut conn net.TcpConn) !(u8, bool, []u8) {
	mut hb := []u8{len: 2}
	mut got := 0
	for got < 2 {
		n := conn.read(mut hb[got..]) or { return error('ws eof') }
		if n == 0 {
			return error('ws eof')
		}
		got += n
	}
	op := hb[0] & 0x0f
	fin := hb[0] & 0x80 != 0
	masked := hb[1] & 0x80 != 0
	mut paylen := int(hb[1] & 0x7f)
	if paylen == 126 {
		ext := ws_read_bytes(mut conn, 2)!
		paylen = int(ext[0]) * 256 + int(ext[1])
	} else if paylen == 127 {
		return error('ws 64-bit len unsupported')
	}
	mut mask := []u8{len: 4}
	if masked {
		mask = ws_read_bytes(mut conn, 4)!
	}
	mut payload := ws_read_bytes(mut conn, paylen)!
	if masked {
		for i in 0 .. paylen {
			payload[i] ^= mask[i % 4]
		}
	}
	return op, fin, payload
}

fn ws_write_pong(mut conn net.TcpConn, payload []u8) ! {
	if payload.len > 125 {
		return
	}
	mut hdr := [u8(0x8a), u8(payload.len & 0x7f)]
	conn.write(hdr)!
	if payload.len > 0 {
		conn.write(payload)!
	}
}

fn ws_write_close(mut conn net.TcpConn, code int, reason string) ! {
	mut body := []u8{}
	body << u8((code >> 8) & 0xff)
	body << u8(code & 0xff)
	body << reason.bytes()
	mut hdr := [u8(0x88), u8(body.len & 0x7f)]
	conn.write(hdr)!
	conn.write(body)!
}
