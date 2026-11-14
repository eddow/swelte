module backend

import crypto.sha256
import db.pg
import json
import os

// Application-owned example: initialized before serving; pg.DB owns its pool.
__global database_pool = &pg.DB{}
__global database_ready = false

pub struct Migration {
pub:
	name string
	statement string
}

pub struct Thread {
pub:
	id string
	title string
	note ?string @[json_null]
	created_at string
	meta map[string]string
	amount string
}

pub fn schema() []Migration {
	return [Migration{'001_threads', 'CREATE TABLE dogfood_threads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, note text, created_at timestamptz NOT NULL DEFAULT now(), meta jsonb NOT NULL DEFAULT \'{}\', amount numeric(12,4) NOT NULL DEFAULT 12.3400)'}]
}

pub fn open_database(url string) !&pg.DB {
	return pg.connect_with_conninfo(url, max_open_conns: 4, max_idle_conns: 2)!
}

// Session locks deliberately use a dedicated physical connection. A failed
// unlock must not return a still-locked session to a pool; close always releases
// it. pg.Conn.reset() in the tested toolchain does not implement cleanup.
pub fn with_lock(url string, key string, work fn (mut pg.Conn) !bool) !bool {
	mut conn := pg.connect_direct_with_conninfo(url)!
	defer { conn.close() or {} }
	rows := conn.exec_param('SELECT pg_try_advisory_lock(hashtext($1))', key)!
	if rows[0].val(0) != 't' { return false }
	defer { conn.exec_param('SELECT pg_advisory_unlock(hashtext($1))', key) or {} }
	return work(mut conn)!
}

pub fn apply_migrations(url string, migrations []Migration) ! {
	mut conn := pg.connect_direct_with_conninfo(url)!
	defer { conn.close() or {} }
	conn.exec_param('SELECT pg_advisory_lock(hashtext($1))', 'swelte-dogfood-schema')!
	defer { conn.exec_param('SELECT pg_advisory_unlock(hashtext($1))', 'swelte-dogfood-schema') or {} }
	conn.exec('CREATE TABLE IF NOT EXISTS dogfood_schema_version (name text PRIMARY KEY, checksum text NOT NULL)')!
	for migration in migrations {
		checksum := sha256.sum(migration.statement.bytes()).hex()
		existing := conn.exec_param('SELECT checksum FROM dogfood_schema_version WHERE name = $1', migration.name)!
		if existing.len > 0 {
			if existing[0].val(0) != checksum { return error('migration checksum changed: ' + migration.name) }
			continue
		}
		conn.begin_on_conn(pg.PQTransactionParam{})!
		conn.exec(migration.statement) or { conn.rollback() or {}; return err }
		conn.exec_param2('INSERT INTO dogfood_schema_version (name, checksum) VALUES ($1, $2)', migration.name, checksum) or { conn.rollback() or {}; return err }
		conn.commit()!
	}
}

pub fn initialize_database() ! {
	url := os.getenv('DATABASE_URL')
	if url == '' { return error('DATABASE_URL is required') }
	mut db := open_database(url)!
	mut migrations := schema()
	if os.getenv('SWELTE_TEST_MIGRATION_FAIL') == '1' {
		migrations << Migration{'intentional_failure', 'CREATE TABLE must_rollback (value int); SELECT missing_function_for_dogfood()'}
	}
	apply_migrations(url, migrations) or { db.close() or {}; return err }
	database_pool = db
	database_ready = true
}

pub fn pool() !&pg.DB {
	if !database_ready { return error('database not initialized') }
	return database_pool
}

pub fn close_database() ! {
	if !database_ready { return }
	database_ready = false
	mut db := database_pool
	db.close()!
}

pub fn list_threads(search string) ![]Thread {
	mut db := pool()!
	rows := db.exec_param('SELECT id::text, title, note, to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\'), meta::text, amount::text FROM dogfood_threads WHERE title ILIKE $1 ORDER BY created_at, id', '%' + search + '%')!
	mut threads := []Thread{}
	for row in rows {
		threads << Thread{row.val(0), row.val(1), row.val_opt(2), row.val(3), json.decode(map[string]string, row.val(4))!, row.val(5)}
	}
	return threads
}

pub fn add_thread(title string) ! {
	mut db := pool()!
	db.exec_param('INSERT INTO dogfood_threads (title) VALUES ($1)', title)!
}
