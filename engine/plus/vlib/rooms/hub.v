// Swelte rooms backend — broadcast hub + WS framing (`emit`/`hub_*`, `ws_*`).
// Staged into `.swelte/backend/` by the Plus `rooms` plugin (`@[ws]` +
// room-mode `@[sse]`). Single-instance best-effort (same tier as Plus cron:
// two containers = two hubs, no distributed lock). Backpressure-safe: cap-1
// per-subscriber buffer, non-blocking send — a slow subscriber drops, never
// stalls the publisher. Unsubscribe closes + removes (no leak, no
// send-on-closed panic).
module backend

import sync

__global swelte_hub = map[string]map[int]chan string{}
__global swelte_hub_mu = sync.Mutex{}
__global swelte_hub_next = map[string]int{}

// --- Broadcast rooms (future.md #4): cross-request SSE fan-out ---
// Hub state (__global) is module-private; the HARNESS owns subscriptions
// (hub_lock + hub_add … hub_remove + hub_unlock); route fns receive the
// injected `sub` closure and never touch the hub directly.
// User code publishes via emit(); routes subscribe via hub_subscribe().

pub fn hub_lock() {
	swelte_hub_mu.lock()
}

pub fn hub_unlock() {
	swelte_hub_mu.unlock()
}

// Register a fresh channel in room, record (room → id). Caller holds the
// lock (hub_lock/hub_unlock). Returns the subscriber id.
pub fn hub_add(room string, ch chan string) int {
	if room !in swelte_hub {
		swelte_hub[room] = map[int]chan string{}
	}
	id := swelte_hub_next[room] or { 0 }
	swelte_hub_next[room] = id + 1
	swelte_hub[room][id] = ch
	return id
}

// Remove + close one subscription. Caller holds the lock (hub_lock/hub_unlock). No-op if gone.
pub fn hub_remove(room string, id int) {
	if room !in swelte_hub {
		return
	}
	if id in swelte_hub[room] {
		swelte_hub[room][id].close()
		swelte_hub[room].delete(id)
	}
}

// Subscribe to a room. Returns the subscriber id; the caller receives on
// the returned channel until it closes (unsubscribe / room drop).
// Cap-1 buffer: the hub never blocks a publisher for a slow reader.
pub fn hub_subscribe(room string) (chan string, int) {
	ch := chan string{cap: 1}
	hub_lock()
	id := hub_add(room, ch)
	hub_unlock()
	return ch, id
}

// Leave a room: close + remove (no leak; publish never hits a closed ch).
pub fn hub_unsubscribe(room string, id int) {
	hub_lock()
	hub_remove(room, id)
	hub_unlock()
}

// Fan out to every live subscriber of room. Returns the delivered count
// (full buffers drop — backpressure-safe, publisher never stalls).
pub fn emit(room string, msg string) int {
	swelte_hub_mu.lock()
	defer { swelte_hub_mu.unlock() }
	mut n := 0
	for _, ch in swelte_hub[room] or { return 0 } {
		select {
			ch <- msg {
				n++
			}
			else {
			}
		}
	}
	return n
}

// Live subscriber count (for health/debug; 0 = nobody listening).
pub fn hub_listeners(room string) int {
	swelte_hub_mu.lock()
	defer { swelte_hub_mu.unlock() }
	return swelte_hub[room] or { map[int]chan string{} }.len
}
