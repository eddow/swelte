// shell backend: one shared shell owned by this module.
// Chat + terminal funnel through the same allowlisted exec/keystroke path
// with per-call authorization; AI calls wait for a human approval record.
// Demo only — not the Phase C tool system.
module shell

import backend
import time

const room_name = 'shell'
const seq_key = 'shell:seq'
const scroll_key_prefix = 'shell:line:'
const approval_prefix = 'shell:approval:'
// Pending stdin lines, queued by `send_input`, drained by `cat`.
const stdin_prefix = 'shell:stdin:'
const stdin_seq_key = 'shell:stdin:seq'
const stdin_head_key = 'shell:stdin:head'
// How long `cat` with an empty buffer waits for keystrokes (100ms polls).
// Sized under the handler budget (SWELTE_HANDLER_TIMEOUT_MS, default 10s).
const stdin_wait_polls = 80
// Room wire version: bump when the frame layout changes so a stale KV
// scrollback tail can never parse as the new protocol.
const room_version = 'v2'
const version_key = 'shell:version'
// Bounded scrollback so a slow consumer cannot grow state without limit.
const scroll_cap = 200

pub struct ExecArgs {
pub:
	cmd    string
	op_id  string
	caller string
}

pub struct ExecResult {
pub:
	ok     bool
	output string
	seq    int
}

pub struct ChatArgs {
pub:
	msg string
}

// Raw keystrokes for a running command's stdin. Queued in KV (drained by
// `cat`) and broadcast as `stdin` frames (painted as `› keys` echoes).
pub struct SendInputArgs {
pub:
	keys string
}

fn allowlisted(name string) bool {
	return name == 'echo' || name == 'pwd' || name == 'whoami' || name == 'help' || name == 'cat'
}

fn cmd_name(cmd string) string {
	parts := cmd.trim_space().split(' ')
	if parts.len == 0 {
		return ''
	}
	return parts[0]
}

fn run_allowlisted(cmd string) string {
	trimmed := cmd.trim_space()
	name := cmd_name(trimmed)
	if !allowlisted(name) {
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

fn publish(line string) int {
	// First write of this boot: the room layout is the framed v2 protocol.
	// A stale pre-v2 KV tail (raw `$ cmd` text) is unframed — reset the
	// scrollback so it can never render as garbage. The shared seq lives
	// in KV (workers don't share `__global` state).
	if (backend.kv_get(version_key) or { '' }) != room_version {
		backend.kv_set(version_key, room_version) or {}
		backend.kv_set(seq_key, '0') or {}
	}
	mut seq := (backend.kv_get(seq_key) or { '0' }).int() + 1
	backend.kv_set(seq_key, seq.str()) or {}
	backend.kv_set(scroll_key_prefix + seq.str(), line) or {}
	if seq > scroll_cap {
		backend.kv_del(scroll_key_prefix + (seq - scroll_cap).str()) or {}
	}
	backend.emit(room_name, line)
	return seq
}

// Room protocol: one publish per event, `kind\npayload`. Kinds:
// `exec\n<cmd>\n<output>` (atomic — cmd and output can never interleave
// with another client's lines), `chat\n<msg>`. Rejected calls publish
// nothing; the caller paints local feedback itself.
fn publish_exec(cmd string, output string) int {
	return publish('exec\n' + cmd + '\n' + output)
}

fn publish_chat(msg string) int {
	return publish('chat\n' + msg)
}

fn publish_stdin(keys string) int {
	return publish('stdin\n' + keys)
}

// Queue one raw stdin line; returns the queue depth after the push.
fn stdin_push(keys string) int {
	tail := (backend.kv_get(stdin_seq_key) or { '0' }).int() + 1
	backend.kv_set(stdin_seq_key, tail.str()) or {}
	backend.kv_set(stdin_prefix + tail.str(), keys) or {}
	return tail - (backend.kv_get(stdin_head_key) or { '1' }).int() + 1
}

// Drain all queued stdin lines (oldest first), advancing the head.
fn stdin_drain() []string {
	mut out := []string{}
	mut head := (backend.kv_get(stdin_head_key) or { '1' }).int()
	tail := (backend.kv_get(stdin_seq_key) or { '0' }).int()
	for head <= tail {
		out << (backend.kv_get(stdin_prefix + head.str()) or { '' })
		backend.kv_del(stdin_prefix + head.str()) or {}
		head += 1
	}
	backend.kv_set(stdin_head_key, head.str()) or {}
	return out
}

fn approval_key(op_id string) string {
	return approval_prefix + op_id
}

@[rpc]
pub fn exec(args ExecArgs) !ExecResult {
	name := cmd_name(args.cmd)
	if name == '' {
		return error('empty command')
	}
	if !allowlisted(name) {
		return error('command not allowlisted: ' + name)
	}
	if args.caller == 'ai' {
		key := approval_key(args.op_id)
		stored := backend.kv_get(key) or { '' }
		if stored == '' {
			backend.kv_set(key, 'pending|' + args.caller + '|' + args.cmd) or {}
			return error('ai shell.exec needs human approval (op ' + args.op_id + ' pending)')
		}
		if stored.starts_with('pending|') {
			return error('ai shell.exec still pending human approval (op ' + args.op_id + ')')
		}
		if stored.starts_with('denied|') || stored.starts_with('expired|') {
			return error('ai shell.exec ' + stored.all_before('|') + ' (op ' + args.op_id + ')')
		}
		if stored.starts_with('done|') {
			prev := stored.all_after_first('|')
			seq := backend.kv_get(seq_key) or { '0' }
			return ExecResult{ ok: true, output: prev, seq: seq.int() }
		}
		if !stored.starts_with('approved|') {
			return error('ai shell.exec not approved (op ' + args.op_id + ')')
		}
		output := run_cat_or_allowlisted(args.cmd)
		backend.kv_set(key, 'done|' + output) or {}
		seq := publish_exec(args.cmd, output)
		return ExecResult{ ok: true, output: output, seq: seq }
	}
	output := run_cat_or_allowlisted(args.cmd)
	seq := publish_exec(args.cmd, output)
	return ExecResult{ ok: true, output: output, seq: seq }
}

// `cat` reads stdin (queued keystrokes, waiting briefly when empty);
// everything else runs through the pure allowlist.
fn run_cat_or_allowlisted(cmd string) string {
	if cmd_name(cmd) != 'cat' {
		return run_allowlisted(cmd)
	}
	drained := stdin_drain()
	if drained.len > 0 {
		return drained.join('\n')
	}
	// Nothing queued: hold the call briefly so keystrokes typed while
	// "running" genuinely arrive as this command's input.
	for _ in 0 .. stdin_wait_polls {
		time.sleep(100 * time.millisecond)
		mut waited := stdin_drain().clone()
		if waited.len > 0 {
			return waited.join('\n')
		}
	}
	return '(no input — timed out)'
}

@[rpc]
pub fn send_input(args SendInputArgs) string {
	if args.keys.trim_space() == '' {
		return 'empty keystrokes'
	}
	stdin_push(args.keys)
	publish_stdin(args.keys)
	return 'queued'
}

@[rpc]
pub fn approve(args ExecArgs) ExecResult {
	key := approval_key(args.op_id)
	stored := backend.kv_get(key) or { '' }
	if stored.starts_with('done|') {
		seq := backend.kv_get(seq_key) or { '0' }
		return ExecResult{ ok: true, output: stored.all_after_first('|'), seq: seq.int() }
	}
	backend.kv_set(key, 'approved|' + args.cmd) or {}
	return ExecResult{ ok: true, output: 'approved ' + args.op_id, seq: 0 }
}

@[rpc]
pub fn deny(args ExecArgs) ExecResult {
	key := approval_key(args.op_id)
	stored := backend.kv_get(key) or { '' }
	if stored.starts_with('done|') {
		seq := backend.kv_get(seq_key) or { '0' }
		return ExecResult{ ok: true, output: stored.all_after_first('|'), seq: seq.int() }
	}
	backend.kv_set(key, 'denied|' + args.cmd) or {}
	return ExecResult{ ok: true, output: 'denied ' + args.op_id, seq: 0 }
}

@[rpc]
pub fn chat(args ChatArgs) ExecResult {
	if args.msg.trim_space() == '' {
		return ExecResult{ ok: false, output: 'empty message', seq: 0 }
	}
	output := 'echo: ' + args.msg
	seq := publish_chat(output)
	return ExecResult{ ok: true, output: output, seq: seq }
}

@[sse]
pub fn stream(req SwelteRequest, sub fn (string) chan string, emit fn (string) bool) {
	_ = req
	ch := sub(room_name)
	tail := backend.kv_get(seq_key) or { '0' }
	last := tail.int()
	from := if last > scroll_cap { last - scroll_cap } else { 0 }
	for i := from + 1; i <= last; i++ {
		line := backend.kv_get(scroll_key_prefix + i.str()) or { '' }
		if line != '' {
			if !emit(line) {
				return
			}
		}
	}
	for {
		select {
			m := <-ch {
				if !emit(m) {
					return
				}
			}
			30 * time.second {
				if !emit('__ping__') {
					return
				}
			}
		}
	}
}