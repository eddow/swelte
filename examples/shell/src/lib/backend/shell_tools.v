// Shell control primitives + reporting/driver tools for the agentic shell
// (spec `docs/specs/agentic-shell.md`). `module backend`: the tools plugin
// claims `@[tool]` fns here; side-effect tools dispatch through the
// generated `tools` module approval table. Human-path RPCs live in
// `src/routes/+page.v` (module shell) and use `backend.kv_*` for the same
// shared KV state.
module backend

import time

// KV keys shared with the route (`+page.v`, module shell) over the same
// `backend.kv_*` store. `shell:driver` holds `human` (no AI in charge) or
// `ai:<holder>` where holder is the owning `runId/turnId`.
// `shell:driver:expires` is unix seconds for the turn lease; scrollback,
// stdin queue and version keys mirror the route constants.
pub const shell_driver_key = 'shell:driver'
pub const shell_driver_expires_key = 'shell:driver:expires'
pub const shell_seq_key = 'shell:seq'
pub const shell_line_prefix = 'shell:line:'
pub const shell_version_key = 'shell:version'
pub const shell_room_version = 'v2'
pub const shell_scroll_cap = 200
pub const shell_stdin_prefix = 'shell:stdin:'
pub const shell_stdin_seq_key = 'shell:stdin:seq'
pub const shell_stdin_head_key = 'shell:stdin:head'
pub const shell_stdin_scope_prefix = 'shell:stdin:scope:'
// Turn-scoped lease: ninety seconds covers a model wait + human approve.
pub const shell_driver_ttl_s = 90

// Parse `ai:<holder>` into the holder, or '' when not AI-held.
pub fn shell_driver_holder(driver string) string {
	if driver == 'human' || driver == '' {
		return ''
	}
	if driver.starts_with('ai:') && driver.len > 3 {
		return driver[3..]
	}
	return ''
}

// True when `driver` grants `holder` the drive right now (holder match +
// lease unexpired against `time.now().unix()`).
pub fn shell_driver_holds(driver string, holder string, expires_unix int) bool {
	if holder == '' {
		return false
	}
	if shell_driver_holder(driver) != holder {
		return false
	}
	return time.now().unix() <= i64(expires_unix)
}

// Allowlisted command names (shared with the route allowlist + the
// frontend mirror in `src/lib/shell.ts`). Single list: adding a command
// means editing all three — deliberate, demo-explicit.
pub fn shell_allowlisted(name string) bool {
	return name == 'echo' || name == 'pwd' || name == 'whoami' || name == 'help' || name == 'cat'
}

pub fn shell_cmd_name(cmd string) string {
	parts := cmd.trim_space().split(' ')
	if parts.len == 0 {
		return ''
	}
	return parts[0]
}

// Stateless demo execution for the allowlist (mirrors the route body:
// `cat` returns its placeholder — queuing/draining lives in the route).
fn shell_run_allowlisted(cmd string) string {
	trimmed := cmd.trim_space()
	name := shell_cmd_name(trimmed)
	if !shell_allowlisted(name) {
		return 'error: command not allowlisted: ' + name
	}
	if name == 'echo' {
		idx := trimmed.index(' ') or { return '' }
		return trimmed[idx + 1..].trim_space()
	}
	if name == 'help' {
		return 'allowlist: echo pwd whoami help cat'
	}
	if name == 'pwd' {
		return '/shell'
	}
	return 'swelte-shell'
}

// Publish one scrollback frame over KV + room (mirrors the route `publish`).
fn shell_publish(line string) int {
	if (kv_get(shell_version_key) or { '' }) != shell_room_version {
		kv_set(shell_version_key, shell_room_version) or {}
		kv_set(shell_seq_key, '0') or {}
	}
	mut seq := (kv_get(shell_seq_key) or { '0' }).int() + 1
	kv_set(shell_seq_key, seq.str()) or {}
	kv_set(shell_line_prefix + seq.str(), line) or {}
	if seq > shell_scroll_cap {
		kv_del(shell_line_prefix + (seq - shell_scroll_cap).str()) or {}
	}
	emit('shell', line)
	return seq
}

fn shell_publish_exec(cmd string, output string) int {
	return shell_publish('exec\n' + cmd + '\n' + output)
}

// Queue keystrokes for a running command (mirrors the route `send_input`).
fn shell_stdin_push(keys string) int {
	tail := (kv_get(shell_stdin_seq_key) or { '0' }).int() + 1
	kv_set(shell_stdin_seq_key, tail.str()) or {}
	kv_set(shell_stdin_prefix + tail.str(), keys) or {}
	return tail - (kv_get(shell_stdin_head_key) or { '1' }).int() + 1
}

fn shell_exec_trunc(output string) string {
	if output.len <= 1024 {
		return output
	}
	return output[..1024] + '…[truncated]'
}

fn shell_frame_short(kind string, cmd string, output string) string {
	if kind == 'exec' {
		return '$ ' + cmd + '\n' + shell_exec_trunc(output)
	}
	if kind == 'stdin' {
		return '› ' + shell_exec_trunc(cmd)
	}
	return shell_exec_trunc(cmd)
}

fn shell_split_frame(line string) (string, string) {
	idx := line.index('\n') or { return line, '' }
	return line[..idx], line[idx + 1..]
}

// Shell reporting tools (Phase C): read-only, deterministic, text-only,
// plus one side-effect tool exercising the dispatch-boundary approval gate.
// No OS shell — same stance as the demo allowlist in `src/lib/shell.ts`.
// The route `src/routes/api/tools.v` selects a subset per run and dispatches
// through the generated `tools` module.

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

pub struct ShellExecArgs {
pub:
	// Allowlisted command to run (`echo pwd whoami help cat`).
	cmd string
	//Owning `runId/turnId` lease holder (`shell:driver` = `ai:<holder>`).
	holder string
	// Dispatch-table approval op id for this exec (Stage C: starting `cat`
	// writes `shell:stdin:scope:<op_id> = holder`).
	op_id string
}

pub struct ShellExecRow {
pub:
	output  string
	seq     int
	pending bool
	note    string
}

// AI shell execution (spec §4): allowlisted commands only, driver-lease
// gated. The dispatch-table approval (`caller + tool + exact args + op_id`)
// runs before this body — approval denial/expiry never reaches here.
// `cat` is non-blocking: it drains queued stdin and returns `{pending:true}`
// (each `send_input` publishes its own `stdin` frame; no fake `exec` row).
// Settled commands publish one atomic `exec` frame and return `{output, seq}`.
// Unknown commands fail actionably without publishing.
// Stage C: `args.op_id` (the dispatch-table approval op id for THIS exec)
// travels in the tool args; starting `cat` writes a scope row
// (`shell:stdin:scope:<op_id> = holder`) — the narrow §6 exception that
// lets later `send_input` calls cite this op id without a fresh record.
// Scope rows are advisory-only: validity is re-checked against the live
// lease at every use (flip/expiry/kill silently dead, §3/§7).
@[tool('side-effect')]
pub fn tool_shell_exec(args ShellExecArgs) !ShellExecRow {
	driver := kv_get(shell_driver_key) or { 'human' }
	expires := (kv_get(shell_driver_expires_key) or { '0' }).int()
	if !shell_driver_holds(driver, args.holder, expires) {
		return error('shell: driver lease not held by ' + args.holder + ' (driver=' + driver + ')')
	}
	name := shell_cmd_name(args.cmd)
	if !shell_allowlisted(name) {
		return error('command not allowlisted: ' + name)
	}
	if args.cmd.trim_space() == '' {
		return error('empty command')
	}
	if name == 'cat' {
		if args.op_id.trim_space() != '' {
			kv_set(shell_stdin_scope_prefix + args.op_id, args.holder) or {}
		}
		mut head := (kv_get(shell_stdin_head_key) or { '1' }).int()
		tail := (kv_get(shell_stdin_seq_key) or { '0' }).int()
		mut out := []u8{}
		for head <= tail {
			out << (kv_get(shell_stdin_prefix + head.str()) or { '' }).bytes()
			head++
		}
		kv_set(shell_stdin_head_key, head.str()) or {}
		return ShellExecRow{
			output:  out.bytestr()
			seq:     (kv_get(shell_seq_key) or { '0' }).int()
			pending: true
			note:    'cat drained queued stdin; poll shell.read_output for later input'
		}
	}
	output := shell_run_allowlisted(args.cmd)
	seq := shell_publish_exec(args.cmd.trim_space(), output)
	return ShellExecRow{ output: output, seq: seq, pending: false }
}

pub struct ShellInputArgs {
pub:
	// Raw keystrokes for the running command's stdin.
	keys string
	//Owning `runId/turnId` lease holder (`shell:driver` = `ai:<holder>`).
	holder string
	// Approval op id for the stdin scope (§6: per-keystroke record, or the
	// pre-approved `exec` op id while its scope is live).
	op_id string
}

pub struct ShellInputRow {
pub:
	ok bool
}

// AI stdin (spec §4/§6): driver-lease gated, queued into the same
// `shell:stdin:*` KV the human path uses, echoed as an `stdin` frame.
// Scoped pre-approval (`shell:stdin:scope:<op_id> = holder`, written by
// the `cat` exec above) is the narrow exact-args exception: a `send_input`
// citing the live exec `op_id` (same holder, lease still held) flows
// without a fresh dispatch record; per-keystroke approval otherwise. The
// generated dispatcher still gates every `send_input` call on its own
// dispatch record — the scope row only decides whether the caller needs a
// *fresh human decision* (scope live → auto-record+approve path) or a
// parked `waiting_approval` (no scope / dead scope).
@[tool('side-effect')]
pub fn tool_shell_send_input(args ShellInputArgs) !ShellInputRow {
	driver := kv_get(shell_driver_key) or { 'human' }
	expires := (kv_get(shell_driver_expires_key) or { '0' }).int()
	if !shell_driver_holds(driver, args.holder, expires) {
		return error('shell: driver lease not held by ' + args.holder + ' (driver=' + driver + ')')
	}
	shell_stdin_push(args.keys)
	shell_publish('stdin\n' + args.keys)
	return ShellInputRow{ ok: true }
}

// Scope check (Stage C): `op_id` grants stdin while it names a live scope
// row for this holder AND the driver lease is still held. Dead on flip,
// expiry, or holder change — the caller falls back to per-keystroke
// approval. Pure read, no mutation.
pub fn shell_stdin_scope_holds(op_id string, holder string) bool {
	if op_id.trim_space() == '' || holder.trim_space() == '' {
		return false
	}
	scoped := kv_get(shell_stdin_scope_prefix + op_id) or { '' }
	if scoped != holder {
		return false
	}
	driver := kv_get(shell_driver_key) or { 'human' }
	expires := (kv_get(shell_driver_expires_key) or { '0' }).int()
	return shell_driver_holds(driver, holder, expires)
}

pub struct ShellReadArgs {
pub:
	// Exclusive cursor: last `seq` the model has seen (0 = from tail start).
	since_seq int
	// Window size, clamped to 1..5 (reporting-loop discipline).
	limit int
}

pub struct ShellReadRow {
pub:
	// One frame per line, `$ <cmd>\n<output>` / `› <keys>` / chat text.
	// Flat strings (tool projection has no nested structs): the caller
	// splits on the first `\n` for `seq|kind|text` framing is avoided —
	// parallel `seqs`/`kinds` arrays stay index-aligned instead.
	lines    []string
	seqs     []int
	kinds    []string
	next_seq int
}

// AI scrollback window (spec §5-B/C): read-only cursor page over the same
// KV the SSE tail serves. One frame = one row (`exec` atomic, never split;
// `stdin` echoes; `chat` included by design for re-entry). Rows ≤1024B
// with truncation marked. Read-only → no approval touch.
@[tool]
pub fn tool_shell_read_output(args ShellReadArgs) !ShellReadRow {
	limit := if args.limit <= 0 { 5 } else if args.limit > 5 { 5 } else { args.limit }
	since := if args.since_seq < 0 { 0 } else { args.since_seq }
	last := (kv_get(shell_seq_key) or { '0' }).int()
	mut lines := []string{}
	mut seqs := []int{}
	mut kinds := []string{}
	if last > since {
		mut start := if last - since > shell_scroll_cap { last - shell_scroll_cap } else { since + 1 }
		if start < 1 {
			start = 1
		}
		mut i := if last - limit + 1 > start { last - limit + 1 } else { start }
		if i < 1 {
			i = 1
		}
		for i <= last {
			line := kv_get(shell_line_prefix + i.str()) or { '' }
			if line != '' {
				kind, rest := shell_split_frame(line)
				if kind == 'exec' {
					cmd, output := shell_split_frame(rest)
					lines << shell_frame_short('exec', cmd, output)
					seqs << i
					kinds << 'exec'
				} else if kind == 'stdin' {
					lines << shell_frame_short('stdin', rest, '')
					seqs << i
					kinds << 'stdin'
				} else if kind == 'chat' {
					lines << shell_frame_short('chat', rest, '')
					seqs << i
					kinds << 'chat'
				}
			}
			i++
		}
	}
	next := if seqs.len > 0 { seqs[seqs.len - 1] } else { since }
	return ShellReadRow{ lines: lines, seqs: seqs, kinds: kinds, next_seq: next }
}
