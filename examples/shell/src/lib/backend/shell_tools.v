// Shell reporting tools (Phase C): read-only, deterministic, text-only,
// plus one side-effect tool exercising the dispatch-boundary approval gate.
// No KV, no OS shell — same stance as the demo allowlist in `src/lib/shell.ts`.
// The route `src/routes/api/tools.v` selects a subset per run and dispatches
// through the generated `tools` module.
module backend

pub struct TopArgs {
pub:
	limit  int
	// Ranked-window paging: `page` selects the window, `limit` sizes it
	// (default 5, clamped to 1..5 — one call never returns more than five
	// rows). Missing fields decode to zero values, so `{"limit":2}` keeps
	// working: page 0, public-only rows.
	page   int
	// Visibility filter: a ledger row is authorized when it is public
	// (`owner == ''`) or owned by `caller`. Unknown callers see public
	// rows only. Read-only tools pass dispatch-level caller/op as `'',''`;
	// authorization travels inside the args the backend trusts.
	caller string
}

pub struct TopRow {
pub:
	command    string
	count      int
	source_ids []string
}

// Caller-tagged ledger entry: `owner == ''` is public, otherwise the row
// is visible only to that caller.
struct LedgerEntry {
	cmd   string
	owner string
	id    string
}

// Fixed demo ledger: public shell history plus per-caller private rows.
fn shell_ledger() []LedgerEntry {
	return [
		LedgerEntry{ cmd: 'echo hi', owner: '', id: 'cmd-01' },
		LedgerEntry{ cmd: 'echo hi', owner: '', id: 'cmd-02' },
		LedgerEntry{ cmd: 'echo hi', owner: '', id: 'cmd-03' },
		LedgerEntry{ cmd: 'echo hi', owner: '', id: 'cmd-04' },
		LedgerEntry{ cmd: 'pwd', owner: '', id: 'cmd-05' },
		LedgerEntry{ cmd: 'pwd', owner: '', id: 'cmd-06' },
		LedgerEntry{ cmd: 'pwd', owner: '', id: 'cmd-07' },
		LedgerEntry{ cmd: 'whoami', owner: '', id: 'cmd-08' },
		LedgerEntry{ cmd: 'whoami', owner: '', id: 'cmd-09' },
		LedgerEntry{ cmd: 'help', owner: '', id: 'cmd-10' },
		LedgerEntry{ cmd: 'help', owner: '', id: 'cmd-11' },
		LedgerEntry{ cmd: 'cat', owner: '', id: 'cmd-12' },
		LedgerEntry{ cmd: 'echo hi', owner: 'human', id: 'cmd-13' },
		LedgerEntry{ cmd: 'deploy app', owner: 'human', id: 'cmd-14' },
		LedgerEntry{ cmd: 'deploy app', owner: 'human', id: 'cmd-15' },
		LedgerEntry{ cmd: 'deploy app', owner: 'human', id: 'cmd-16' },
		LedgerEntry{ cmd: 'cat secrets', owner: 'ai', id: 'cmd-17' },
		LedgerEntry{ cmd: 'cat secrets', owner: 'ai', id: 'cmd-18' },
	]
}

// Read-only reporting query over the demo ledger (spec §C reporting loop):
// page the caller-authorized records, aggregate in V, return at most five
// ranked rows with source IDs — the model gets the answer in one tool call
// per turn instead of fetching pages and aggregating client-side. Ranking
// is deterministic (count desc, command asc) so pages are stable.
@[tool]
pub fn tool_top_commands(args TopArgs) ![]TopRow {
	limit := if args.limit <= 0 { 5 } else if args.limit > 5 { 5 } else { args.limit }
	page := if args.page < 0 { 0 } else { args.page }
	mut counts := map[string]int{}
	mut ids := map[string][]string{}
	for e in shell_ledger() {
		if e.owner != '' && e.owner != args.caller {
			continue
		}
		counts[e.cmd] = counts[e.cmd] + 1
		if e.cmd in ids {
			mut arr := ids[e.cmd]
			if e.id !in arr {
				arr << e.id
			}
			ids[e.cmd] = arr
		} else {
			ids[e.cmd] = [e.id]
		}
	}
	mut rows := []TopRow{}
	for cmd, n in counts {
		mut sids := ids[cmd].clone()
		sids.sort()
		rows << TopRow{ command: cmd, count: n, source_ids: sids }
	}
	rows.sort_with_compare(fn (a &TopRow, b &TopRow) int {
		if a.count > b.count {
			return -1
		}
		if a.count < b.count {
			return 1
		}
		if a.command < b.command {
			return -1
		}
		if a.command > b.command {
			return 1
		}
		return 0
	})
	start := page * limit
	if start >= rows.len {
		return []TopRow{}
	}
	end := if start + limit > rows.len { rows.len } else { start + limit }
	return rows[start..end]
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
