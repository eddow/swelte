// `@swelte/plus/db` — embedded SQLite/KV (future.md #2, foundation tier).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { defineSweltePlugin, type SweltePlugin } from '@swelte/core/vite'
import { resolveV } from '@swelte/core/toolchain'

/** Default SQLite path when SWELTE_DB_PATH is unset. */
export const PLUS_DB_DEFAULT_PATH = 'data/app.db'

/** Migration tracking table. */
export const PLUS_DB_MIGRATIONS_TABLE = '_swelte_migrations'

/** Resolve the DB path: env wins, else default (absolute). */
export function plusDbPath(root: string, env?: NodeJS.ProcessEnv): string {
	const raw = String(env?.SWELTE_DB_PATH ?? process.env.SWELTE_DB_PATH ?? '').trim()
	if (raw) return resolve(root, raw)
	return resolve(root, PLUS_DB_DEFAULT_PATH)
}

/** List pending migrations: db/migrations/*.sql sorted, minus applied. */
export function plusPendingMigrations(root: string, applied: string[]): string[] {
	const dir = join(root, 'db', 'migrations')
	let files: string[] = []
	try {
		files = readdirSync(dir)
			.filter((f) => f.endsWith('.sql'))
			.sort()
	} catch {
		return []
	}
	const done = new Set(applied)
	return files.filter((f) => !done.has(f))
}

/** Absolute dir of the shipped V backend module (`vlib/backend/*.v`).
 * Walks up from this file to the package root (works from src and dist:
 * `src/db.ts` → root, `dist/db.js` → root). No package.json self-reference
 * (exports map blocks `./package.json`). */
export function plusDbVlibDir(): string {
	let dir = dirname(fileURLToPath(import.meta.url))
	for (let i = 0; i < 4; i++) {
		const cand = join(dir, 'vlib', 'backend')
		if (existsSync(join(cand, 'db.v'))) return cand
		const parent = dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	// Fallback: sibling of this file's package (monorepo src layout).
	return join(dirname(fileURLToPath(import.meta.url)), '..', 'vlib', 'backend')
}

/** V source for the user-owned `src/lib/backend/db.v` helper: the shipped
 *  `vlib/backend/db.v` verbatim (single source of truth). */
export function dbHelperTemplate(): string {
	return readFileSync(join(plusDbVlibDir(), 'db.v'), 'utf8')
}

/** Initial migration: KV table (app tables are user's own SQL). */
export function dbInitialMigration(): string {
	return [
		'-- Swelte embedded DB: initial migration (@swelte/plus/db).',
		'-- KV store: SSE rooms, SWR regen state, offline outbox build on this.',
		'create table if not exists swelte_kv (',
		'\tkey text primary key,',
		'\tvalue text not null',
		');',
		'',
	].join('\n')
}

/** Run `swelte migrate`: scaffold helper + KV migration, then apply pendings.
 * Real work happens in V (single-binary story): emit `.swelte/migrate.v`
 * and `v run` it. Idempotent — re-runs apply only new files. */
export function runMigrate(root: string, log: (m: string) => void): void {
	const helper = join(root, 'src', 'lib', 'backend', 'db.v')
	if (!existsSync(helper)) {
		mkdirSync(join(root, 'src', 'lib', 'backend'), { recursive: true })
		writeFileSync(helper, dbHelperTemplate())
		log('created src/lib/backend/db.v (backend-only helper)')
	}
	const first = join(root, 'db', 'migrations', '001_swelte_kv.sql')
	if (!existsSync(first)) {
		mkdirSync(join(root, 'db', 'migrations'), { recursive: true })
		writeFileSync(first, dbInitialMigration())
		log('created db/migrations/001_swelte_kv.sql')
	}
	const escRoot = root.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
	const lines = [
		'module main',
		'',
		'import db.sqlite',
		'import os',
		'',
		'fn main() {',
		`\troot := '${escRoot}'`,
		"\tdb_path := os.getenv_opt('SWELTE_DB_PATH') or { '' }",
		"\tpath := if db_path != '' { db_path } else { root + '/data/app.db' }",
		"\tdir := path.all_before_last('/')",
		"\tif dir != '' && dir != path {",
		'\t\tos.mkdir_all(dir) or {}',
		'\t}',
		'\tmut conn := sqlite.connect(path) or { panic(err.msg()) }',
		"\tconn.exec('pragma journal_mode = WAL;') or { panic('journal_mode failed: ' + err.msg()) }",
		'\tconn.busy_timeout(5000)',
		// V target: if conn.exec_none('create table ... default (datetime(\'now\'))') != 101 {
		"\tif conn.exec_none('create table if not exists " +
			PLUS_DB_MIGRATIONS_TABLE +
			" (name text primary key, applied_at text not null default (datetime(\\'now\\')))')" +
			' != 101 {',
		"\t\tpanic('migrations table failed')",
		'\t}',
		`\tapplied_rows := conn.exec('select name from ${PLUS_DB_MIGRATIONS_TABLE}') or { []sqlite.Row{} }`,
		'\tmut applied := map[string]bool{}',
		'\tfor r in applied_rows {',
		"\t\tapplied[r.get_string('name')] = true",
		'\t}',
		"\tmig_dir := root + '/db/migrations'",
		'\tfiles := os.ls(mig_dir) or { []string{} }',
		"\tmut sorted := files.filter(it.ends_with('.sql'))",
		'\tsorted.sort()',
		'\tmut n := 0',
		'\tfor f in sorted {',
		'\t\tif applied[f] {',
		'\t\t\tcontinue',
		'\t\t}',
		"\t\tsql_text := os.read_file(mig_dir + '/' + f) or { panic(err.msg()) }",
		"\t\tif conn.exec_none(sql_text) != 101 { panic('migration ' + f + ' failed') }",
		"\t\tif conn.exec_none('insert into " +
			PLUS_DB_MIGRATIONS_TABLE +
			" (name) values (\\'' + f + '\\')') != 101 { panic('track ' + f + ' failed') }",
		"\t\tprintln('migrated: ' + f)",
		'\t\tn++',
		'\t}',
		"\tconn.exec_none('pragma wal_checkpoint(TRUNCATE);')",
		"\tif n == 0 { println('migrate: up to date') }",
		"\telse { println('migrate: applied ' + n.str() + ' migration(s)') }",
		'}',
		'',
	]
	mkdirSync(join(root, '.swelte'), { recursive: true })
	writeFileSync(join(root, '.swelte', 'migrate.v'), lines.join('\n'))
	// resolveV needs a core-internal path (finds @swelte/vvm via require).
	// The plus dist URL works: createRequire resolves @swelte/core from here.
	let vbin = 'v'
	try {
		const req = createRequire(import.meta.url)
		const coreToolchain = req.resolve('@swelte/core/toolchain')
		vbin = resolveV(pathToFileURL(coreToolchain).href)
	} catch {
		vbin = 'v'
	}
	execFileSync(vbin || 'v', ['run', join(root, '.swelte', 'migrate.v')], {
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env },
	})
}

export const dbPlugin: SweltePlugin = defineSweltePlugin({
	name: 'db',
	attrs: [],
	configKey: 'db',
	includes: () => [{ module: 'backend', absDir: plusDbVlibDir() }],
	cli: [
		{
			name: 'migrate',
			summary:
				'Apply db/migrations/*.sql to the embedded SQLite file (scaffolds helper + KV table on first run).',
			args: [
				{ name: 'root', help: 'Project root', value: 'string' },
				{ name: 'db', help: 'SQLite path (else SWELTE_DB_PATH, else data/app.db)', value: 'string' },
			],
			run(ctx) {
				const root = resolve(String(ctx.opts.root ?? process.cwd()))
				const dbOverride = String(ctx.opts.db ?? '').trim()
				if (dbOverride) process.env.SWELTE_DB_PATH = dbOverride
				runMigrate(root, ctx.log)
			},
		},
	],
})

