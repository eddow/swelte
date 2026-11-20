// Swelte embedded DB + broadcast hub (@swelte/plus/db).
// Lives at src/lib/backend/db.v — backend-only, importable from #routes/*.v.
// Single SQLite file (WAL mode). Path: SWELTE_DB_PATH env, else data/app.db.
// Hub (future.md #4): in-memory pub/sub rooms — `emit(room, msg)` fans out to
// every live `hub_subscribe(room)` SSE stream in THIS process.
// Single-instance best-effort (same tier as cron: two containers = two hubs,
// no distributed lock). Backpressure-safe: cap-1 per-subscriber buffer,
// non-blocking send — a slow subscriber drops, never stalls the publisher.
// Unsubscribe closes + removes (no leak, no send-on-closed panic).
module backend

import db.sqlite
import os
import sync

__global swelte_db = sqlite.DB{}
__global swelte_hub = map[string]map[int]chan string{}
__global swelte_hub_mu = sync.Mutex{}
__global swelte_hub_next = map[string]int{}

fn swelte_db_path() string {
	raw := os.getenv_opt('SWELTE_DB_PATH') or { '' }
	if raw != '' {
		return raw
	}
	return 'data/app.db'
}

// Open (or reuse) the shared connection. Creates parent dirs.
pub fn db() !sqlite.DB {
	if swelte_db.is_open {
		return swelte_db
	}
	path := swelte_db_path()
	dir := path.all_before_last('/')
	if dir != '' && dir != path {
		os.mkdir_all(dir) or {}
	}
	mut conn := sqlite.connect(path)!
	conn.exec('pragma journal_mode = WAL;') or { return err }
	conn.busy_timeout(5000)
	swelte_db = conn
	return swelte_db
}

// KV: rooms / regen state / outbox queue build on this.
// NOTE: DDL/DML use exec_none (exec only steps row queries).
pub fn kv_get(key string) !string {
	c := db()!
	rows := c.exec("select value from swelte_kv where key = '" + key + "'")!
	if rows.len == 0 {
		return error('kv miss: ' + key)
	}
	return rows[0].get_string('value')
}

pub fn kv_set(key string, value string) ! {
	mut c := db()!
	if c.exec_none('create table if not exists swelte_kv (key text primary key, value text not null)') != 101 {
		return error('kv init failed')
	}
	if c.exec_none("insert into swelte_kv (key, value) values ('" + key + "', '" + value + "') on conflict(key) do update set value=excluded.value") != 101 {
		return error('kv set failed')
	}
}

pub fn kv_del(key string) ! {
	mut c := db()!
	if c.exec_none("delete from swelte_kv where key = '" + key + "'") != 101 {
		return error('kv del failed')
	}
}

// --- Broadcast rooms (future.md #4): cross-request SSE fan-out ---
// Hub state (__global) is module-private; main reaches it ONLY through the
// pub fns below (V forbids cross-module global access). The HARNESS owns
// subscriptions (hub_lock + hub_add … hub_remove + hub_unlock); route fns
// receive the injected `sub` closure and never touch the hub directly.
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
