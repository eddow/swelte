module runner

import crypto.sha256
import db.sqlite
import npm_swelte_dogfood_ai1.runner.formatting

// Native interfaces and callbacks are not browser RPC signatures.
pub interface Store {
	save(value string) !string
}

pub struct MemoryStore {
pub:
	prefix string
}

pub fn (s MemoryStore) save(value string) !string {
	return s.prefix + value
}

fn publish(out chan string, value string) {
	out <- value
	out.close()
}

pub fn run(store Store, input string, emit fn (string) bool) !string {
	value := store.save(formatting.normalize(input))!
	out := chan string{cap: 1}
	spawn publish(out, value)
	message := <-out or { return error('producer closed without a message') }
	if !emit(message) {
		return error('subscriber cancelled')
	}
	return message
}

// A real native database link, not a PostgreSQL integration substitute.
pub fn database_probe() !int {
	mut db := sqlite.connect(':memory:')!
	defer { db.close() or {} }
	row := db.exec_one('select 7')!
	return row.vals[0].int()
}

pub fn digest(value string) string {
	return sha256.sum(value.bytes()).hex()
}
