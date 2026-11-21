// shell/ai dogfood backend: one shared shell owned by this module.
// Chat + terminal funnel through the same allowlisted exec/keystroke path
// with per-call authorization; AI calls wait for a human approval record.
// Dogfood only — not the Phase C tool system.
module shell_ai

import backend
import time

const room_name = 'shell-ai'
const seq_key = 'shell-ai:seq'
const scroll_key_prefix = 'shell-ai:line:'
const approval_prefix = 'shell-ai:approval:'
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

pub struct SendInputArgs {
pub:
	keys   string
	op_id  string
	caller string
}

pub struct ChatArgs {
pub:
	msg string
}

__global shell_seq int

fn allowlisted(name string) bool {
	return name == 'echo' || name == 'pwd' || name == 'whoami' || name == 'help'
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
		return 'allowlist: echo pwd whoami help'
	}
	if name == 'pwd' {
		return '/shell/ai'
	}
	return 'dogfood'
}

fn next_seq() int {
	shell_seq += 1
	return shell_seq
}

fn publish(line string) int {
	seq := next_seq()
	backend.kv_set(seq_key, seq.str()) or {}
	backend.kv_set(scroll_key_prefix + seq.str(), line) or {}
	if seq > scroll_cap {
		backend.kv_del(scroll_key_prefix + (seq - scroll_cap).str()) or {}
	}
	backend.emit(room_name, line)
	return seq
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
		output := run_allowlisted(args.cmd)
		backend.kv_set(key, 'done|' + output) or {}
		seq := publish('$ ' + args.cmd + '\n' + output)
		return ExecResult{ ok: true, output: output, seq: seq }
	}
	output := run_allowlisted(args.cmd)
	seq := publish('$ ' + args.cmd + '\n' + output)
	return ExecResult{ ok: true, output: output, seq: seq }
}

@[rpc]
pub fn send_input(args SendInputArgs) int {
	if args.keys.len == 0 {
		return backend.hub_listeners(room_name)
	}
	return publish(args.keys)
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
	seq := publish(output)
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

@[ws]
pub fn term(req SwelteRequest, sub fn (string) chan string, recv chan string, emit fn (string) bool) {
	_ = req
	ch := sub(room_name)
	for {
		select {
			m := <-ch {
				if !emit(m) {
					return
				}
			}
			line := <-recv {
				publish(line)
			}
		}
	}
}

