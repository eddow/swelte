// Separate from app data: an exclusive transaction spans each due job.
// SQLite releases it on process death; an uncommitted deadline is retried.
module sweltejobs

import db.sqlite
import os
import time

pub fn open(path string) !sqlite.DB {
	os.mkdir_all(os.dir(path))!
	mut db := sqlite.connect(path)!
	db.busy_timeout(5000)
	db.exec('PRAGMA journal_mode=WAL')!
	if db.exec_none('CREATE TABLE IF NOT EXISTS swelte_jobs (name TEXT PRIMARY KEY, every_seconds INTEGER NOT NULL, next_run INTEGER NOT NULL, last_run INTEGER, last_status TEXT)') != 101 {
		return error('jobs schema initialization failed')
	}
	db.busy_timeout(50)
	return db
}

// False means another instance owns the DB or the named job is not due.
// A true result leaves a transaction open until complete()/rollback().
pub fn claim(mut db sqlite.DB, name string, seconds int) !bool {
	code := db.exec_none('BEGIN IMMEDIATE')
	if code == 5 || code == 6 { return false }
	if code != 101 { return error('jobs transaction failed') }
	mut claimed := false
	defer {
		if !claimed { db.exec_none('ROLLBACK') }
	}
	now := time.now().unix()
	db.exec_param_many('INSERT OR IGNORE INTO swelte_jobs(name,every_seconds,next_run) VALUES(?,?,?)', [
		name,
		seconds.str(),
		(now + seconds).str(),
	])!
	rows := db.exec_param('SELECT next_run FROM swelte_jobs WHERE name=?', name)!
	if rows.len != 1 || rows[0].vals[0].i64() > now {
		if db.exec_none('COMMIT') != 101 { return error('jobs commit failed') }
		return false
	}
	claimed = true
	return true
}

pub fn complete(mut db sqlite.DB, name string, seconds int, status string) ! {
	now := time.now().unix()
	db.exec_param_many('UPDATE swelte_jobs SET every_seconds=?, next_run=?, last_run=?, last_status=? WHERE name=?', [
		seconds.str(),
		(now + seconds).str(),
		now.str(),
		status,
		name,
	])!
	if db.exec_none('COMMIT') != 101 { return error('jobs completion failed') }
}
