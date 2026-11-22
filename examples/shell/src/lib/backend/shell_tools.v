// Shell reporting tools (Phase C): read-only, deterministic, text-only,
// plus one side-effect tool exercising the dispatch-boundary approval gate.
// No KV, no OS shell — same stance as the demo allowlist in `src/lib/shell.ts`.
// The route `src/routes/api/tools.v` selects a subset per run and dispatches
// through the generated `tools` module.
module backend

pub struct TopArgs {
pub:
	limit int
}

pub struct TopRow {
pub:
	command string
	count   int
}

// Fixed demo ledger: counts + ranks commands, top `limit` first.
@[tool]
pub fn tool_top_commands(args TopArgs) ![]TopRow {
	if args.limit <= 0 {
		return error('limit must be positive')
	}
	ledger := ['echo hi', 'pwd', 'echo hi', 'whoami', 'echo hi', 'pwd', 'cat']
	mut counts := map[string]int{}
	for cmd in ledger {
		counts[cmd] = counts[cmd] + 1
	}
	mut rows := []TopRow{}
	for cmd, n in counts {
		rows << TopRow{ command: cmd, count: n }
	}
	rows.sort(a.count > b.count)
	if rows.len > args.limit {
		return rows[..args.limit]
	}
	return rows
}

pub struct ShortenArgs {
pub:
	text  string
	limit int
}

// Pure truncation helper (exercises the non-fallible tool arm).
@[tool]
pub fn tool_shorten(args ShortenArgs) string {
	if args.text.len <= args.limit {
		return args.text
	}
	return args.text[..args.limit]
}

pub struct NoteArgs {
pub:
	text string
}

pub struct NoteRow {
pub:
	note string
}

// Side-effecting demo note (needs backend approval at the dispatch
// boundary). No-op body: the gate is the point — record + decide before
// dispatch, deny/expiry/duplicates/lost-ack without executing.
@[tool('side-effect')]
pub fn tool_publish_note(args NoteArgs) !NoteRow {
	if args.text.len == 0 {
		return error('note must not be empty')
	}
	return NoteRow{ note: args.text }
}
