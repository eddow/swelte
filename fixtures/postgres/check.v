module main

import backend
import db.pg
import os

fn main() {
	check() or { eprintln(err.msg()); exit(1) }
	println('PASS: native PostgreSQL parameters, rollback, row decoding, migration replay/failure and pinned advisory locks')
}

fn check() ! {
	url := os.getenv('DATABASE_URL')
	backend.initialize_database()!
	backend.apply_migrations(url, backend.schema())!
	mut db := backend.pool()!
	assert db.q_int('SELECT count(*) FROM dogfood_schema_version')! == 1
	poison := "parameter'); DROP TABLE dogfood_threads; --"
	backend.add_thread(poison)!
	db.exec_param2('UPDATE dogfood_threads SET meta = $1::jsonb WHERE title = $2', '{"source":"native"}', poison)!
	rows := backend.list_threads(poison)!
	assert rows.len == 1
	assert rows[0].title == poison
	assert rows[0].id.len == 36
	assert rows[0].created_at.ends_with('Z')
	assert rows[0].amount == '12.3400'
	assert rows[0].meta['source'] == 'native'
	if _ := rows[0].note { return error('SQL NULL was flattened') }
	mut tx := db.begin(pg.PQTransactionParam{})!
	tx.exec_param('INSERT INTO dogfood_threads (title) VALUES ($1)', 'must roll back')!
	tx.rollback()!
	assert backend.list_threads('must roll back')!.len == 0
	mut holder := pg.connect_direct_with_conninfo(url)!
	holder.exec_param('SELECT pg_advisory_lock(hashtext($1))', 'dogfood-lock')!
	acquired := backend.with_lock(url, 'dogfood-lock', fn (mut conn pg.Conn) !bool {
		return error('contending lock callback must not execute')
	})!
	assert !acquired
	holder.close()!
	backend.with_lock(url, 'dogfood-lock', fn (mut conn pg.Conn) !bool {
		return error('provider failure')
	}) or { assert err.msg() == 'provider failure' }
	assert backend.with_lock(url, 'dogfood-lock', fn (mut conn pg.Conn) !bool { return true })!
	backend.apply_migrations(url, [backend.Migration{'broken', 'CREATE TABLE must_rollback (id int); SELECT deliberately_missing_function()'}]) or {
		assert db.q_int("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'must_rollback'")! == 0
	}
	assert db.q_int("SELECT count(*) FROM dogfood_schema_version WHERE name = 'broken'")! == 0
	backend.apply_migrations(url, [backend.Migration{'001_threads', 'SELECT 1'}]) or {
		assert err.msg().contains('checksum changed')
		return
	}
	return error('expected changed migration to fail')
}
