// Swelte embedded DB helper (@swelte/plus/db template).
// Lives at src/lib/backend/db.v — backend-only, importable from #routes/*.v.
// Single SQLite file (WAL mode). Path: SWELTE_DB_PATH env, else data/app.db.
module backend

import db.sqlite
import os

__global swelte_db = sqlite.DB{}

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
