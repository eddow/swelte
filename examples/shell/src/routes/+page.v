// shell backend: one shared shell owned by this module.
// Chat + terminal funnel through the same allowlisted exec/keystroke path
// with per-call authorization; AI calls wait for a human approval record.
// Demo only — not the Phase C tool system.
module shell

import backend
import json
import net.http
import os
import time
import tools

const room_name = 'shell'
const seq_key = 'shell:seq'
const scroll_key_prefix = 'shell:line:'
// Legacy demo approval path retired (spec §4): AI shell calls dispatch
// through the generated `tools` table (`tool_shell_exec`, single approval
// record per op). `approval_prefix` stays as the key shape only so old KV
// rows are recognizable; the `exec` RPC no longer reads/writes them.
const approval_prefix = 'shell:approval:'
// Pending stdin lines, queued by `send_input`, drained by `cat`.
const stdin_prefix = 'shell:stdin:'
const stdin_seq_key = 'shell:stdin:seq'
const stdin_head_key = 'shell:stdin:head'
// Driver lease (§3): `shell:driver` = `human` | `ai:<holder runId/turnId>`;
// `shell:driver:expires` = unix seconds. Holder-bound single driver —
const driver_key = 'shell:driver'
const driver_expires_key = 'shell:driver:expires'
const driver_ttl_s = 90
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
// Transcript-tail re-entry (§5-C, Stage C): compact orientation for a
// turn that starts while the model idled. Last `n` scrollback frames
// (same KV the SSE tail serves), one row per frame in `$ <cmd>\n<output>`
// / `› <keys>` / chat form, ≤1024B with truncation marked. Empty when the
// scrollback is empty — the caller omits the context line instead.
fn transcript_tail(n int) string {
	cap := if n <= 0 { 5 } else if n > 10 { 10 } else { n }
	last := (backend.kv_get(seq_key) or { '0' }).int()
	if last <= 0 {
		return ''
	}
	mut start := last - cap + 1
	if start < 1 {
		start = 1
	}
	mut out := ''
	mut i := start
	for i <= last {
		line := backend.kv_get(scroll_key_prefix + i.str()) or { '' }
		if line != '' {
			nl := line.index('\n') or { -1 }
			kind := if nl < 0 { line } else { line[..nl] }
			rest := if nl < 0 { '' } else { line[nl + 1..] }
			mut row := ''
			if kind == 'exec' {
				nl2 := rest.index('\n') or { -1 }
				if nl2 < 0 {
					row = '$ ' + rest
				} else {
					row = '$ ' + rest[..nl2] + '\n' + rest[nl2 + 1..]
				}
			} else if kind == 'stdin' {
				row = '› ' + rest
			} else if kind == 'chat' {
				row = rest
			}
			if row != '' {
				if out != '' {
					out += '\n---\n'
				}
				out += row
			}
		}
		i++
	}
	if out == '' {
		return ''
	}
	if out.len > 1024 {
		out = out[..1021] + '...'
	}
	return out
}


fn approval_key(op_id string) string {
	return approval_prefix + op_id
}

// Driver lease (§3). `shell_driver_holder` mirrors the backend helper
// (`module backend` in `shell_tools.v` — the route is `module shell`, so it
// keeps its own copy over the same KV).
fn shell_driver_holder(driver string) string {
	if driver == 'human' || driver == '' {
		return ''
	}
	if driver.starts_with('ai:') && driver.len > 3 {
		return driver[3..]
	}
	return ''
}

fn shell_driver_holds(driver string, holder string, expires_unix int) bool {
	if holder == '' {
		return false
	}
	if shell_driver_holder(driver) != holder {
		return false
	}
	return time.now().unix() <= i64(expires_unix)
}

// Non-RPC lease read for the stream verb scope (`@[rpc]` fns are not
// visible from `swelte_stream` closures — same KV read, no dispatch).
fn stream_held_driver() string {
	return backend.kv_get(driver_key) or { 'human' }
}

// Non-RPC lease read for the stream verb scope (`@[rpc]` fns are not
// visible from `swelte_stream` closures — same KV read, no dispatch).
// Release the AI lease back to `human` (cause traced by the caller via the
// pane event). Idempotent: a `human` driver stays `human`.
fn shell_driver_release(cause string) {
	driver := backend.kv_get(driver_key) or { 'human' }
	if shell_driver_holder(driver) == '' {
		if driver != 'human' {
			backend.kv_set(driver_key, 'human') or {}
		}
		return
	}
	backend.kv_set(driver_key, 'human') or {}
	backend.kv_set(driver_expires_key, '0') or {}
	publish_chat('driver → human (' + cause + ')')
}

pub struct DriverArgs {
pub:
	// Owning `runId/turnId` for this turn's drive.
	holder string
}

pub struct DriverResult {
pub:
	ok     bool
	driver string
	note   string
}

// Handoff (§3): explicit per-turn request. Fail-closed under contention —
// a second holder is rejected while a live lease holds. Re-checks expiry
// with the wall clock: a lapsed lease is treated as free even if the KV row
// still names the old holder.
@[rpc]
pub fn shell_handoff(args DriverArgs) !DriverResult {
	if args.holder.trim_space() == '' {
		return error('shell: handoff needs a holder runId/turnId')
	}
	driver := backend.kv_get(driver_key) or { 'human' }
	expires := (backend.kv_get(driver_expires_key) or { '0' }).int()
	if shell_driver_holds(driver, shell_driver_holder(driver), expires) {
		cur := shell_driver_holder(driver)
		if cur != args.holder {
			return error('shell: driver held by ' + cur + ' (single driver)')
		}
		return DriverResult{ ok: true, driver: driver, note: 'lease already held by this turn' }
	}
	held := 'ai:' + args.holder
	backend.kv_set(driver_key, held) or {}
	backend.kv_set(driver_expires_key, (time.now().unix() + i64(driver_ttl_s)).str()) or {}
	publish_chat('driver → ' + held + ' (handoff)')
	return DriverResult{ ok: true, driver: held, note: 'handoff granted for this turn' }
}

// Turn end / interrupt path (§3): explicit release. The human terminal
// submit and Stop press call this (or `exec` flips implicitly) so a late
// tool result after the flip is rejected, never applied.
@[rpc]
pub fn shell_release(args DriverArgs) !DriverResult {
	_ = args
	shell_driver_release('turn-end')
	return DriverResult{ ok: true, driver: 'human', note: 'released' }
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
		// Legacy demo path retired: AI shell calls dispatch through the
		// generated `tools` table (`tool_shell_exec`, approval-gated) — the
		// human `exec` RPC no longer parks `shell:approval:*` records.
		return error('ai shell calls dispatch via tool_shell_exec (approval-gated)')
	}
	// Any human command preempts an AI lease (§3): flip first so only
	// keys queued before the flip can still drain.
	shell_driver_release('human-input')
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
	// Human keystrokes ride the human path: any AI lease they preempt flips
	// first (§3), so only keys queued before the flip can still drain.
	shell_driver_release('human-input')
	stdin_push(args.keys)
	publish_stdin(args.keys)
	return 'queued'
}

pub struct ToolApprovalArgs {
pub:
	op_id    string
	decision string
	tool     string
	cmd      string
}

// Approval decisions for AI tool ops (spec §6): recorded against the op id
// the dispatch table binds (`caller + tool + exact args + op_id`). Human
// `exec` calls no longer consult these — the tools route (`api/tools.v`)
// records + decides via the generated `tools` module instead. These RPCs
// stay as the pane-facing decision surface; the queue UI drives them.
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

// AI configuration proxy: adapter + model + run config.
//
// Configs live in the browser (localStorage, no keys). The server holds
// keys in env (populated from `.env` by the CLI) and runs provider HTTP
// here, so keys never reach the browser. `deterministic` echoes offline.

// --- AI chat streaming (POST verb → swelte_stream SSE) ---
//
// The non-streaming `ai_chat` RPC stays as the fallback. This verb reads
// the same AiChatArgs from the JSON body and emits engine events as SSE:
// `text.delta` per provider chunk, `terminal` at the end. The shell chat
// pane is the dogfood consumer for `@swelte/ai` event shapes.

@[post('ai_stream')]
pub fn ai_stream(req SwelteRequest) !SwelteResponse {
	// Form-encoded (fetch posts urlencoded so JSON content-type doesn't hit
	// the RPC `fn` dispatch): adapter/model/prompt/temperature/max_tokens/system.
	prompt := (req.form['prompt'] or { '' }).trim_space()
	if prompt == '' {
		return error('empty prompt')
	}
	if (req.form['model'] or { '' }).trim_space() == '' {
		return error('model required')
	}
	adapter := req.form['adapter'] or { '' }
	if adapter != 'deterministic' && adapter != 'openrouter' && adapter != 'openai' && adapter != 'anthropic' {
		return error('unknown adapter: ' + adapter)
	}
	model := req.form['model'] or { '' }
	temperature := (req.form['temperature'] or { '-1' }).f64()
	max_tokens := (req.form['max_tokens'] or { '-1' }).int()
	system := req.form['system'] or { '' }
	run_id := 'run-' + time.now().unix_nano().str()
	drive := (req.form['drive'] or { '' }) == '1'
	holder := if drive { run_holder(run_id) } else { '' }
	if drive {
		// Per-turn handoff before the text pass: the driving tail parks
		// against `ai:<holder>`; a live lease rejects (single driver).
		// Inline (not `shell_handoff`): `fn` RPCs are not visible here.
		if holder.trim_space() == '' {
			return error('shell: handoff needs a holder runId/turnId')
		}
		cur_driver := backend.kv_get(driver_key) or { 'human' }
		cur_expires := (backend.kv_get(driver_expires_key) or { '0' }).int()
		if shell_driver_holds(cur_driver, shell_driver_holder(cur_driver), cur_expires) {
			cur := shell_driver_holder(cur_driver)
			if cur != holder {
				return error('shell: driver held by ' + cur + ' (single driver)')
			}
		} else {
			held_name := 'ai:' + holder
			backend.kv_set(driver_key, held_name) or {}
			backend.kv_set(driver_expires_key, (time.now().unix() + i64(driver_ttl_s)).str()) or {}
			publish_chat('driver → ' + held_name + ' (handoff)')
		}
	}
	return swelte_stream({'Content-Type': 'text/event-stream'}, fn [run_id, adapter, model, prompt, temperature, max_tokens, system, holder] (stream SwelteStream) ! {
		ai_stream_run(stream, run_id, adapter, model, prompt, temperature, max_tokens, system, holder)
	})
}

fn ai_sse_emit(stream SwelteStream, run_id string, output_id string, kind string, seq int, payload string) bool {
	msg := 'event: ' + kind + '\ndata: {"envelope":{"runId":"' + run_id + '","outputId":"' + output_id + '","kind":"' + kind + '","seq":' + seq.str() + '},"payload":' + payload + '}\n\n'
	return stream.write(msg.bytes())
}

// Holder for this stream run: `runId/turn-1` — the frontend's first turn
// id for the run, so resume + release address the same holder.
fn run_holder(run_id string) string {
	return run_id + '/turn-1'
}

fn ai_stream_run(stream SwelteStream, run_id string, adapter string, model string, prompt string, temperature f64, max_tokens int, system string, holder string) {
	mut ctx := AiStreamCtx{ run_id: run_id }
	if adapter == 'deterministic' {
		full := 'echo: ' + prompt
		// Word-at-a-time so the pane exercises the incremental path even
		// for the offline adapter.
		for word in full.split(' ') {
			if !ai_sse_delta(stream, mut ctx, word + ' ') {
				return
			}
			time.sleep(30 * time.millisecond)
		}
		// Deterministic drive stub: exercises the driving tail without a
		// provider key — parks one dispatch record, closes waiting_approval.
		if holder != '' {
			held := stream_held_driver()
			if shell_driver_holder(held) == holder {
				args := '{"cmd":"pwd","holder":' + json.encode(holder) + ',"op_id":' + json.encode(holder + '-op-1') + '}'
				tools.swelte_tool_approval_record('ai', drive_exec_name, args, holder + '-op-1')
				ai_sse_emit(stream, ctx.run_id, 'out-text', 'approval.request', new_tool_seq(mut ctx), '{"cmd":' + json.encode(drive_exec_name) + ',"op_id":' + json.encode(holder + '-op-1') + ',"tool":' + json.encode(drive_exec_name) + ',"args":' + json.encode(args) + ',"holder":' + json.encode(holder) + '}')
				ai_sse_delta(stream, mut ctx, '\n[parked ' + drive_exec_name + ' ' + holder + '-op-1 waiting_approval]')
			}
		}
		ai_sse_terminal(stream, mut ctx, 'completed', '')
		return
	}
	env_name := ai_env_for_adapter(adapter)
	key := os.getenv_opt(env_name) or { '' }
	if key == '' {
		ai_sse_terminal(stream, mut ctx, 'failed', adapter + ': missing ' + env_name + ' (server env only — add it to .env)')
		return
	}
	ok := ai_stream_provider(stream, mut ctx, adapter, model, prompt, temperature, max_tokens, system, key, holder) or {
		ai_sse_terminal(stream, mut ctx, 'failed', err.msg())
		return
	}
	_ = ok
	ai_sse_terminal(stream, mut ctx, 'completed', '')
}

// Mutable stream cursor: V forbids `mut seq int` params, so sequence lives
// in this struct passed as `mut ctx`. `pub` so codegen keeps it valid:
// `pub struct` → Page_-prefixed vType, `pub fn` likewise.
pub struct AiStreamCtx {
pub mut:
	run_id string
	seq    int
}

fn ai_sse_delta(stream SwelteStream, mut ctx AiStreamCtx, text string) bool {
	ctx.seq++
	return ai_sse_emit(stream, ctx.run_id, 'out-text', 'text.delta', ctx.seq, '{"text":' + json.encode(text) + '}')
}

fn ai_sse_terminal(stream SwelteStream, mut ctx AiStreamCtx, reason string, err_msg string) {
	ctx.seq++
	if err_msg == '' {
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'terminal', ctx.seq, '{"reason":"' + reason + '"}')
		return
	}
	ai_sse_emit(stream, ctx.run_id, 'out-text', 'terminal', ctx.seq, '{"reason":"' + reason + '","error":' + json.encode(err_msg) + '}')
}
fn ai_msg_list(prompt string, system string) string {
	mut messages := ''
	if system.trim_space() != '' {
		messages = '{"role":"system","content":' + json.encode(system) + '},'
	}
	messages += '{"role":"user","content":' + json.encode(prompt) + '}'
	return messages
}

fn ai_openrouter_extra(temperature f64, max_tokens int) string {
	mut extra := ''
	if max_tokens > 0 {
		extra += ',"max_tokens":' + max_tokens.str()
	}
	if temperature >= 0 {
		extra += ',"temperature":' + temperature.str()
	}
	return extra
}

fn ai_openai_extra(temperature f64, max_tokens int) string {
	mut extra := ''
	if max_tokens > 0 {
		extra += ',"max_output_tokens":' + max_tokens.str()
	}
	if temperature >= 0 {
		extra += ',"temperature":' + temperature.str()
	}
	return extra
}

// Index of the closing quote honoring `\"` escapes, or -1.
fn ai_json_end(s string) int {
	mut j := 0
	for j < s.len {
		if s[j] == `\\` {
			j += 2
			continue
		}
		if s[j] == `"` {
			return j
		}
		j++
	}
	return -1
}

// One provider SSE data-frame → one text delta. OpenRouter uses
// `choices[0].delta.content`; OpenAI Responses uses `output_text.delta`
// `delta`; Anthropic uses `content_block_delta` `delta.text`.
fn ai_extract_provider_delta(adapter string, data string) string {
	if adapter == 'openai' {
		marker := '"delta":"'
		idx := data.index(marker) or { return '' }
		rest := data[idx + marker.len..]
		end := ai_json_end(rest)
		if end < 0 {
			return ''
		}
		return ai_json_unescape(rest[..end])
	}
	if adapter == 'anthropic' {
		marker := '"text":"'
		idx := data.index(marker) or { return '' }
		rest := data[idx + marker.len..]
		end := ai_json_end(rest)
		if end < 0 {
			return ''
		}
		return ai_json_unescape(rest[..end])
	}
	marker := '"content":"'
	idx := data.index(marker) or { return '' }
	rest := data[idx + marker.len..]
	end := ai_json_end(rest)
	if end < 0 {
		return ''
	}
	return ai_json_unescape(rest[..end])
}

// AI observe turn (§2 Stage A / §10.2 fixture 3): example-local,
// read-only. After the provider text completes, a second non-streaming
// pass asks the model to emit one `<tool name args-json>` line naming a
// read-only shell tool (`tool_shell_read_output`, optionally
// `tool_top_commands`); the backend parses that single line, dispatches
// with an observe-only allowlist (caller `ai-observe`, never the lease
// holder), and feeds the bounded result back as turn text. One parse, one
// dispatch, read-only tools only — no lease, no approval, no mutation.
// Malformed/no line → plain text turn, no error.
const drive_read_name = 'backend.shell_tools.tool_shell_read_output'
const drive_top_name = 'backend.shell_tools.tool_top_commands'

fn ai_observe_tool_json() string {
	return '{"tools":[{"name":"' + drive_read_name + '","input":{"since_seq":"last seq seen (int, exclusive cursor; 0 = tail)","limit":"rows, 1..5"}},{"name":"' + drive_top_name + '","input":{"limit":"rows ≤5","page":"window","caller":"visibility ledger"}}]}'
}

fn ai_observe_followup_body(adapter string, model string, prompt string, first_text string, temperature f64, max_tokens int) string {
	tool_json := ai_observe_tool_json()
	mut sys := 'You are observing a shared terminal. Reply with exactly one line `<tool full-name single-line-json-args>` using only: ' + tool_json + ' Never emit shell.exec or shell.send_input; observation only.'
	tail := transcript_tail(5)
	if tail != '' {
		sys += '\nRecent terminal transcript (context, not a tool result):\n' + tail
	}
	user := 'User asked: ' + prompt + '\nAssistant said: ' + first_text + '\nNow emit the single observe tool-call line.'
	if adapter == 'openrouter' {
		return '{"model":' + json.encode(model) + ',"stream":false,"messages":[{"role":"system","content":' + json.encode(sys) + '},{"role":"user","content":' + json.encode(user) + '}]' + ai_openrouter_extra(temperature, max_tokens) + '}'
	}
	if adapter == 'openai' {
		return '{"model":' + json.encode(model) + ',"input":[{"role":"system","content":' + json.encode(sys) + '},{"role":"user","content":' + json.encode(user) + '}]' + ai_openai_extra(temperature, max_tokens) + '}'
	}
	max_tok := if max_tokens > 0 { max_tokens } else { 128 }
	mut body := '{"model":' + json.encode(model) + ',"max_tokens":' + max_tok.str() + ',"messages":[{"role":"user","content":' + json.encode(user) + '}],"system":' + json.encode(sys)
	if temperature >= 0 {
		body += ',"temperature":' + temperature.str()
	}
	return body + '}'
}

// Parse one `<tool name {json}>` line: full tool name + single-line JSON
// args, or '' when absent so the turn degrades to plain text.
fn ai_parse_observe_call(text string) (string, string) {
	for line in text.split('\n') {
		trimmed := line.trim_space()
		if !trimmed.starts_with('<tool ') || !trimmed.ends_with('>') {
			continue
		}
		inner := trimmed[6..trimmed.len - 1].trim_space()
		sp := inner.index(' ') or { continue }
		name := inner[..sp].trim_space()
		args := inner[sp + 1..].trim_space()
		if name == '' || !args.starts_with('{') || !args.ends_with('}') {
			continue
		}
		if args.contains('\n') {
			continue
		}
		return name, args
	}
	return '', ''
}

// Stage B driving tail (§2 Stage B / §10.2 fixtures 1–2): same two-pass
// shape as the observe tail, but the turn holds `shell:driver =
// ai:<holder>` before the text pass, so a parked `tool_shell_exec` /
// `tool_shell_send_input` line dispatches holder-bound (caller 'ai') from
// inside the generated dispatch table against the per-turn allowlist
// (all three) + exact-args approval + live lease. A parked call publishes
// the dispatch-table `approval.request` frame (terminal-styled in the
// pane) instead of resolving: the SSE stream closes `waiting_approval`
// (see §6 — never held open); the human approves/denies over the legacy
// `approve`/`deny` RPCs, and `shell_tool_resume` drains the recorded
// decision, dispatches exactly once, and paints the exec frame + result
// back to the run narrative. Human `exec`/`send_input` preempt the lease,
// so a post-flip resume fails closed as superseded.
const drive_exec_name = 'backend.shell_tools.tool_shell_exec'
const drive_input_name = 'backend.shell_tools.tool_shell_send_input'

pub struct ToolResumeArgs {
pub:
	op_id     string
	holder    string
	tool      string
	args_json string
}

pub struct ToolResumeResult {
pub:
	ok     bool
	output string
	seq    int
	status string
}

// Resume a parked driving call after the human decides: re-check the
// holder lease incl. expiry (a flip or TTL lapse since parking fails closed),
// record the human decision on the dispatch-table record, dispatch once
// through the generated table (replay-safe on duplicate resume), and return
// the bounded result. Unknown/decided-pending/mismatch op ids are actionable
// errors, never hangs. The frontend passes back the parked tool + args it
// already holds — the backend never trusts them alone: dispatch re-checks
// caller + tool + exact args + op id against the recorded triple.
@[rpc]
pub fn shell_tool_resume(args ToolResumeArgs) !ToolResumeResult {
	driver := stream_held_driver()
	expires := (backend.kv_get(driver_expires_key) or { '0' }).int()
	if !shell_driver_holds(driver, args.holder, expires) {
		return error('shell: drive superseded (driver=' + driver + '); in-flight AI call denied')
	}
	tools.swelte_tool_approval_decide(args.op_id, 'approved')
	res := tools.swelte_tool_dispatch([drive_read_name, drive_top_name, drive_exec_name, drive_input_name], args.tool, args.args_json, 'ai', args.op_id) or {
		return error(err.msg())
	}
	out, seq := shell_tool_resume_shape(res)
	return ToolResumeResult{ ok: true, output: out, seq: seq, status: 'approved' }
}

// Deny a parked driving call after the human refuses it: re-check the
// holder lease incl. expiry, mark the dispatch-table record denied (so any
// late resume fails closed as denied instead of dispatching), and return the
// denial. A flipped/expired lease simply drops the call (deny is idempotent).
@[rpc]
pub fn shell_tool_deny(args ToolResumeArgs) !ToolResumeResult {
	driver := stream_held_driver()
	expires := (backend.kv_get(driver_expires_key) or { '0' }).int()
	if !shell_driver_holds(driver, args.holder, expires) {
		tools.swelte_tool_approval_decide(args.op_id, 'denied')
		return ToolResumeResult{ ok: true, output: 'denied (superseded)', seq: 0, status: 'denied' }
	}
	tools.swelte_tool_approval_decide(args.op_id, 'denied')
	return ToolResumeResult{ ok: true, output: 'denied by human', seq: 0, status: 'denied' }
}
// Shape the dispatch result for the run narrative: exec rows surface
// `{output, seq}`, input rows `{ok}` — substring scan, no full decode.
fn shell_tool_resume_shape(res_json string) (string, int) {
	mut out := res_json
	mut seq := 0
	oi := res_json.index('"output"') or { -1 }
	if oi >= 0 {
		rest := res_json[oi + 8..].trim_space()
		colon := rest.index(':') or { -1 }
		if colon >= 0 {
			val := rest[colon + 1..].trim_space()
			if val.starts_with('"') {
				end := val[1..].index('"') or { -1 }
				if end >= 0 {
					out = val[1..end + 1]
				}
			} else {
				end := val.index(',') or { val.index('}') or { -1 } }
				if end >= 0 {
					out = val[..end].trim_space()
				}
			}
		}
	}
	si := res_json.index('"seq"') or { -1 }
	if si >= 0 {
		rest := res_json[si + 5..].trim_space()
		colon := rest.index(':') or { -1 }
		if colon >= 0 {
			num := rest[colon + 1..].trim_space()
			mut digits := ''
			for ch in num {
				if ch >= `0` && ch <= `9` {
					digits += ch.ascii_str()
				} else {
					break
				}
			}
			if digits != '' {
				seq = digits.int()
			}
		}
	}
	return out, seq
}


// Driving schema line: all three shell tools (exec/input/read) so a
// handed-off turn can act; the backend allowlist + lease + approval still
// gate every call.
fn ai_drive_tool_json() string {
	return '{"tools":[{"name":"' + drive_read_name + '","input":{"since_seq":"last seq seen (int, exclusive cursor; 0 = tail)","limit":"rows, 1..5"}},{"name":"' + drive_exec_name + '","input":{"cmd":"allowlisted command","holder":"this turn holder","op_id":"approval op id"}},{"name":"' + drive_input_name + '","input":{"keys":"keystrokes","holder":"this turn holder","op_id":"approval op id"}}]}'
}

fn ai_drive_followup_body(adapter string, model string, prompt string, first_text string, holder string, temperature f64, max_tokens int) string {
	tool_json := ai_drive_tool_json()
	mut sys := 'You hold this turn-only terminal lease. Reply with exactly one line `<tool full-name single-json-args>` using only: ' + tool_json
	tail := transcript_tail(5)
	if tail != '' {
		sys += '\nRecent terminal transcript (context, not a tool result):\n' + tail
	}
	user := 'User asked: ' + prompt + '\nLease holder: ' + holder + '\nAssistant said: ' + first_text
	if adapter == 'openrouter' {
		return '{"model":' + json.encode(model) + ',"stream":false,"messages":[{"role":"system","content":' + json.encode(sys) + '},{"role":"user","content":' + json.encode(user) + '}]' + ai_openrouter_extra(temperature, max_tokens) + '}'
	}
	if adapter == 'openai' {
		return '{"model":' + json.encode(model) + ',"input":[{"role":"system","content":' + json.encode(sys) + '},{"role":"user","content":' + json.encode(user) + '}]' + ai_openai_extra(temperature, max_tokens) + '}'
	}
	max_tok := if max_tokens > 0 { max_tokens } else { 128 }
	mut body := '{"model":' + json.encode(model) + ',"max_tokens":' + max_tok.str() + ',"messages":[{"role":"user","content":' + json.encode(user) + '}],"system":' + json.encode(sys)
	if temperature >= 0 {
		body += ',"temperature":' + temperature.str()
	}
	return body + '}'
}

fn ai_drive_args_field(args_json string, field string) string {
	needle := '"' + field + '"'
	fi := args_json.index(needle) or { return '' }
	rest := args_json[fi + needle.len..].trim_space()
	colon := rest.index(':') or { return '' }
	val := rest[colon + 1..].trim_space()
	if val.starts_with('"') {
		end := val[1..].index('"') or { return '' }
		return val[1..end + 1]
	}
	end := val.index(',') or { val.index('}') or { return '' } }
	return val[..end].trim_space()
}

// Stage B turn tail: same two-pass shape as Stage A, but the caller holds
// the lease and the allowlist covers all three tools. Read-only calls
// resolve inline (observe path); exec/input park one dispatch-table
// record, publish approval.request, close waiting_approval.
fn ai_drive_turn_tail(stream SwelteStream, mut ctx AiStreamCtx, adapter string, model string, prompt string, first_text string, holder string, temperature f64, max_tokens int, _key string, header http.Header) {
	held := stream_held_driver()
	if shell_driver_holder(held) != holder {
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.exec"},"label":"drive superseded"}')
		return
	}
	body := ai_drive_followup_body(adapter, model, prompt, first_text, holder, temperature, max_tokens)
	resp := http.fetch(url: ai_base_url_for_adapter(adapter) + ai_chat_path_for_adapter(adapter), method: .post, header: header, data: body) or {
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.exec"},"label":"drive skipped"}')
		return
	}
	if resp.status_code != 200 {
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.exec"},"label":"drive skipped"}')
		return
	}
	reply := ai_extract_text_blobs(resp.body)
	name, args := ai_parse_observe_call(reply)
	if name == '' {
		return
	}
	allowed := [drive_read_name, drive_top_name, drive_exec_name, drive_input_name]
	if name !in allowed {
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.exec"},"label":"drive rejected"}')
		return
	}
	if name == drive_read_name || name == drive_top_name {
		result := tools.swelte_tool_dispatch(allowed, name, args, 'ai-observe', '') or {
			ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.read_output"},"label":"observe failed"}')
			return
		}
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.read_output"},"label":"shell.read_output","detail":' + json.encode(short_tool_text(result)) + '}')
		ai_sse_delta(stream, mut ctx, '\n[observed ' + name + ': ' + short_tool_text(result) + ']')
		return
	}
	op_id := ai_drive_args_field(args, 'op_id')
	call_holder := ai_drive_args_field(args, 'holder')
	if op_id == '' || call_holder == '' {
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.exec"},"label":"drive rejected"}')
		return
	}
	if call_holder != holder {
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.exec"},"label":"drive rejected"}')
		return
	}
	// Stage C scoped pre-approval (§6): a `send_input` citing the live `cat`
	// exec `op_id` (same holder, lease still held) auto-records + dispatches
	// inline — no parked `waiting_approval`, no fresh human decision. The
	// scope row dies with the turn/flip, so a stale cite falls through to
	// the parked per-keystroke path below.
	if name == drive_input_name && backend.shell_stdin_scope_holds(op_id, holder) {
		tools.swelte_tool_approval_record('ai', name, args, op_id)
		tools.swelte_tool_approval_decide(op_id, 'approved')
		result := tools.swelte_tool_dispatch(allowed, name, args, 'ai', op_id) or {
			ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.send_input"},"label":"stdin failed","detail":' + json.encode(err.msg()) + '}')
			return
		}
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.send_input"},"label":"shell.send_input (scoped)","detail":' + json.encode(short_tool_text(result)) + '}')
		ai_sse_delta(stream, mut ctx, '\n[stdin scoped ' + op_id + ': ' + short_tool_text(result) + ']')
		return
	}
	tools.swelte_tool_approval_record('ai', name, args, op_id)
	ai_sse_emit(stream, ctx.run_id, 'out-text', 'approval.request', new_tool_seq(mut ctx), '{"cmd":' + json.encode(name) + ',"op_id":' + json.encode(op_id) + ',"tool":' + json.encode(name) + ',"args":' + json.encode(args) + ',"holder":' + json.encode(holder) + '}')
	ai_sse_delta(stream, mut ctx, '\n[parked ' + name + ' ' + op_id + ' waiting_approval]')
}

// Stage A turn tail: one non-streaming tool-call pass (observe tools
// only), dispatch, `tool.progress` + bounded result text back into the
// same turn. Never throws: every failure degrades to plain text.
fn ai_observe_turn_tail(stream SwelteStream, mut ctx AiStreamCtx, adapter string, model string, prompt string, first_text string, temperature f64, max_tokens int, _key string, header http.Header) {
	body := ai_observe_followup_body(adapter, model, prompt, first_text, temperature, max_tokens)
	resp := http.fetch(url: ai_base_url_for_adapter(adapter) + ai_chat_path_for_adapter(adapter), method: .post, header: header, data: body) or {
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.read_output"},"label":"observe skipped","detail":' + json.encode('tool pass failed: ' + err.msg()) + '}')
		return
	}
	if resp.status_code != 200 {
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.read_output"},"label":"observe skipped","detail":' + json.encode(adapter + ': HTTP ' + resp.status_code.str()) + '}')
		return
	}
	reply := ai_extract_text_blobs(resp.body)
	name, args := ai_parse_observe_call(reply)
	if name == '' {
		return
	}
	allowed := [drive_read_name, drive_top_name]
	if name !in allowed {
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.read_output"},"label":"observe rejected","detail":' + json.encode('tool not selected for this run: ' + name) + '}')
		return
	}
	result := tools.swelte_tool_dispatch(allowed, name, args, 'ai-observe', '') or {
		ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.read_output"},"label":"observe failed","detail":' + json.encode(err.msg()) + '}')
		return
	}
	ai_sse_emit(stream, ctx.run_id, 'out-text', 'tool.progress', new_tool_seq(mut ctx), '{"tool":{"name":"shell.read_output"},"label":"shell.read_output","detail":' + json.encode(short_tool_text(result)) + '}')
	ai_sse_delta(stream, mut ctx, '\n[observed ' + name + ': ' + short_tool_text(result) + ']')
}

fn ai_chat_path_for_adapter(adapter string) string {
	if adapter == 'openrouter' {
		return '/chat/completions'
	}
	if adapter == 'openai' {
		return '/responses'
	}
	return '/v1/messages'
}

// Bounded tool text for the turn: ≤1024B, truncation marked (spec §5).
fn short_tool_text(s string) string {
	if s.len <= 1024 {
		return s
	}
	return s[..1021] + '...'
}

// Separate tool-row cursor so `tool.progress` rows never collide with
// `text.delta` seqs in the chat pane's replay guard.
fn new_tool_seq(mut ctx AiStreamCtx) int {
	ctx.seq++
	return ctx.seq
}

// Stage B: the provider text streams first (pane keeps its incremental
// path); the observe-turn tail then runs one tool-call pass and feeds the
// bounded result back into the same turn. `first_text` is the streamed
// reply, collected alongside the deltas; the tail degrades to plain text
// on any failure — the terminal event below always closes the turn.
// `holder` is '' for observe turns; a driving turn passes its
// `runId/turnId`, which must already hold `shell:driver = ai:<holder>`
// (handed off before the text pass).
fn ai_stream_provider(stream SwelteStream, mut ctx AiStreamCtx, adapter string, model string, prompt string, temperature f64, max_tokens int, system string, key string, holder string) !bool {
	if adapter == 'openrouter' {
		body := '{"model":' + json.encode(model) + ',"stream":true,"stream_options":{"include_usage":true},"messages":[' + ai_msg_list(prompt, system) + ']' + ai_openrouter_extra(temperature, max_tokens) + '}'
		step := ai_stream_sse_post(stream, 'https://openrouter.ai/api/v1/chat/completions', key, adapter, body, mut ctx) or {
			return error(err.msg())
		}
		first_text := step.collected
		if step.cont {
			if holder != '' {
				ai_drive_turn_tail(stream, mut ctx, adapter, model, prompt, first_text, holder, temperature, max_tokens, key, ai_bearer_json(key, adapter))
			} else {
				ai_observe_turn_tail(stream, mut ctx, adapter, model, prompt, first_text, temperature, max_tokens, key, ai_bearer_json(key, adapter))
			}
		}
		return step.cont
	}
	if adapter == 'openai' {
		body := '{"model":' + json.encode(model) + ',"stream":true,"input":[' + ai_msg_list(prompt, system) + ']' + ai_openai_extra(temperature, max_tokens) + '}'
		mut header := http.new_header(key: .authorization, value: 'Bearer ' + key)
		header.add(.content_type, 'application/json')
		step := ai_stream_fetch(stream, 'https://api.openai.com/v1/responses', header, body, adapter, mut ctx) or {
			return error(err.msg())
		}
		first_text := step.collected
		if step.cont {
			if holder != '' {
				ai_drive_turn_tail(stream, mut ctx, adapter, model, prompt, first_text, holder, temperature, max_tokens, key, header)
			} else {
				ai_observe_turn_tail(stream, mut ctx, adapter, model, prompt, first_text, temperature, max_tokens, key, header)
			}
		}
		return step.cont
	}
	max_tok := if max_tokens > 0 { max_tokens } else { 1024 }
	mut body := '{"model":' + json.encode(model) + ',"stream":true,"max_tokens":' + max_tok.str() + ',"messages":[{"role":"user","content":' + json.encode(prompt) + '}]'
	if system.trim_space() != '' {
		body += ',"system":' + json.encode(system)
	}
	if temperature >= 0 {
		body += ',"temperature":' + temperature.str()
	}
	body += '}'
	mut header := http.new_header(key: .content_type, value: 'application/json')
	header.add_custom('x-api-key', key) or { return error('anthropic: bad key header') }
	header.add_custom('anthropic-version', '2023-06-01') or { return error('anthropic: bad version header') }
	step := ai_stream_fetch(stream, 'https://api.anthropic.com/v1/messages', header, body, adapter, mut ctx) or {
		return error(err.msg())
	}
	first_text := step.collected
	if step.cont {
		if holder != '' {
			ai_drive_turn_tail(stream, mut ctx, adapter, model, prompt, first_text, holder, temperature, max_tokens, key, header)
		} else {
			ai_observe_turn_tail(stream, mut ctx, adapter, model, prompt, first_text, temperature, max_tokens, key, header)
		}
	}
	return step.cont
}

fn ai_bearer_json(key string, adapter string) http.Header {
	mut header := http.new_header(key: .content_type, value: 'application/json')
	header.add(.authorization, 'Bearer ' + key)
	if adapter == 'openrouter' {
		header.add_custom('HTTP-Referer', 'http://localhost/') or {}
		header.add_custom('X-Title', 'swelte-shell') or {}
	}
	return header
}

// Provider SSE streamed as full-body scan: each `data:` line becomes an
// engine `text.delta`. The V http client buffers the response, so this
// emits once the provider completes — the pane still paints one bubble
// that grows per delta instead of a single wait-then-all flash. OpenRouter
// honors `stream:true`; OpenAI/Anthropic fall back to the chunked full
// reply below when their SSE shape differs. Returns collected text next to
// the keep-going flag (V forbids `mut string` params).
pub struct StreamStep {
pub:
	cont      bool
	collected string
}

fn ai_stream_sse_post(stream SwelteStream, url string, key string, adapter string, body string, mut ctx AiStreamCtx) !StreamStep {
	resp := http.fetch(url: url, method: .post, header: ai_bearer_json(key, adapter), data: body) or {
		return error(adapter + ': request failed: ' + err.msg())
	}
	if resp.status_code != 200 {
		return error(adapter + ': HTTP ' + resp.status_code.str())
	}
	mut pending := resp.body
	mut collected := ''
	for {
		nl := pending.index('\n') or { break }
		line := pending[..nl].trim_space()
		pending = pending[nl + 1..]
		if line == '' || !line.starts_with('data:') {
			continue
		}
		data := line[5..].trim_space()
		if data == '[DONE]' {
			continue
		}
		chunk := ai_extract_provider_delta(adapter, data)
		if chunk != '' {
			collected += chunk
			if !ai_sse_delta(stream, mut ctx, chunk) {
				return StreamStep{ cont: false, collected: collected }
			}
		}
	}
	return StreamStep{ cont: true, collected: collected }
}

// Non-SSE providers: split the full reply into chunks so the pane still
// paints incrementally instead of wait-then-all.
fn ai_stream_fetch(stream SwelteStream, url string, header http.Header, body string, adapter string, mut ctx AiStreamCtx) !StreamStep {
	mut hdr := header
	resp := http.fetch(url: url, method: .post, header: hdr, data: body) or {
		return error(adapter + ': request failed: ' + err.msg())
	}
	if resp.status_code != 200 {
		return error(adapter + ': HTTP ' + resp.status_code.str())
	}
	text := ai_extract_text_blobs(resp.body)
	if text != '' {
		mut rest := text
		for rest.len > 0 {
			cut := if rest.len > 120 { 120 } else { rest.len }
			if !ai_sse_delta(stream, mut ctx, rest[..cut]) {
				return StreamStep{ cont: false, collected: text }
			}
			rest = rest[cut..]
		}
	}
	return StreamStep{ cont: true, collected: text }
}





pub struct AiChatArgs {
pub:
	adapter     string
	model       string
	prompt      string
	temperature f64 = -1
	max_tokens  int = -1
	system      string
}

pub struct AiChatResult {
pub:
	ok     bool
	output string
	model  string
}

pub struct AiAdapterKey {
pub:
	adapter    string
	env_var    string
	configured bool
}

fn ai_env_for_adapter(adapter string) string {
	if adapter == 'openrouter' {
		return 'OPENROUTER_API_KEY'
	}
	if adapter == 'openai' {
		return 'OPENAI_API_KEY'
	}
	if adapter == 'anthropic' {
		return 'ANTHROPIC_API_KEY'
	}
	return ''
}

fn ai_base_url_for_adapter(adapter string) string {
	if adapter == 'openrouter' {
		return 'https://openrouter.ai/api/v1'
	}
	if adapter == 'openai' {
		return 'https://api.openai.com/v1'
	}
	if adapter == 'anthropic' {
		return 'https://api.anthropic.com'
	}
	return ''
}

// Which adapters have a server-side key configured. The chat UI labels
// each configuration (ready vs missing key) without ever seeing keys.
pub struct AiKeyProbe {
pub:
	dummy string
}

@[rpc]
pub fn ai_key_status(args AiKeyProbe) []AiAdapterKey {
	_ = args
	return [
		AiAdapterKey{'deterministic', '', true},
		AiAdapterKey{'openrouter', 'OPENROUTER_API_KEY', os.getenv_opt('OPENROUTER_API_KEY') or { '' } != ''},
		AiAdapterKey{'openai', 'OPENAI_API_KEY', os.getenv_opt('OPENAI_API_KEY') or { '' } != ''},
		AiAdapterKey{'anthropic', 'ANTHROPIC_API_KEY', os.getenv_opt('ANTHROPIC_API_KEY') or { '' } != ''},
	]
}

// Live model list for the config combo-box.
//
// OpenRouter publishes GET /api/v1/models (public, no key — `{data:[{id,
// name, …}]}`); OpenAI/Anthropic also list over HTTP but need their keys,
// so they fetch server-side too and stay hidden when unkeyed. Results are
// cached in KV for 10 minutes (the catalog is ~1MB); failures fall back to
// the stale cache, then to the client-side suggestions.
pub struct AiModelsArgs {
pub:
	adapter string
}

fn ai_models_cache_key(adapter string) string {
	return 'shell:ai:models:' + adapter
}

fn ai_models_cache_ttl() i64 {
	return 600
}

@[rpc]
pub fn ai_models(args AiModelsArgs) []string {
	if args.adapter == 'deterministic' {
		return ['deterministic-1']
	}
	if args.adapter != 'openrouter' && args.adapter != 'openai' && args.adapter != 'anthropic' {
		return []
	}
	cached := backend.kv_get(ai_models_cache_key(args.adapter)) or { '' }
	if cached != '' {
		bar := cached.index('|') or { -1 }
		if bar > 0 {
			stamp := cached[..bar].i64()
			if stamp > 0 && time.now().unix() - stamp < ai_models_cache_ttl() {
				return cached[bar + 1..].split('\n')
			}
		}
	}
	fresh := ai_fetch_models(args.adapter) or { []string{} }
	if fresh.len == 0 {
		if cached != '' {
			bar := cached.index('|') or { -1 }
			if bar > 0 {
				return cached[bar + 1..].split('\n')
			}
		}
		return []
	}
	backend.kv_set(ai_models_cache_key(args.adapter), time.now().unix().str() + '|' + fresh.join('\n')) or {}
	return fresh
}

fn ai_fetch_models(adapter string) ![]string {
	if adapter == 'openrouter' {
		resp := http.fetch(url: 'https://openrouter.ai/api/v1/models', method: .get) or {
			return error('openrouter models: ' + err.msg())
		}
		if resp.status_code != 200 {
			return error('openrouter models: HTTP ' + resp.status_code.str())
		}
		return ai_model_ids(resp.body)
	}
	env_name := ai_env_for_adapter(adapter)
	key := os.getenv_opt(env_name) or { '' }
	if key == '' {
		return error(adapter + ': missing ' + env_name)
	}
	if adapter == 'openai' {
		mut header := http.new_header(key: .content_type, value: 'application/json')
		header.add(.authorization, 'Bearer ' + key)
		resp := http.fetch(url: 'https://api.openai.com/v1/models', method: .get, header: header) or {
			return error('openai models: ' + err.msg())
		}
		if resp.status_code != 200 {
			return error('openai models: HTTP ' + resp.status_code.str())
		}
		return ai_model_ids(resp.body)
	}
	mut header := http.new_header(key: .content_type, value: 'application/json')
	header.add_custom('x-api-key', key) or {}
	header.add_custom('anthropic-version', '2023-06-01') or {}
	resp := http.fetch(url: 'https://api.anthropic.com/v1/models', method: .get, header: header) or {
		return error('anthropic models: ' + err.msg())
	}
	if resp.status_code != 200 {
		return error('anthropic models: HTTP ' + resp.status_code.str())
	}
	return ai_model_ids(resp.body)
}

// Substring scan for `"id":"…"` blobs — the catalog is ~1MB, no full
// JSON decode needed for the demo path.
fn ai_model_ids(body string) []string {
	mut out := []string{}
	mut seen := map[string]bool{}
	mut rest := body
	for {
		needle := '"id":"'
		idx := rest.index(needle) or { break }
		rest = rest[idx + needle.len..]
		end := rest.index('"') or { break }
		id := rest[..end]
		rest = rest[end + 1..]
		// Keep bare ids too (openai/anthropic native lists use `gpt-4o`
		// style ids without a `/`).
		if id == '' || seen[id] {
			continue
		}
		seen[id] = true
		out << id
		if out.len >= 300 {
			break
		}
	}
	return out
}

// Non-streaming chat completion: one prompt in, one reply out.
@[rpc]
pub fn ai_chat(args AiChatArgs) !AiChatResult {
	prompt := args.prompt.trim_space()
	if prompt == '' {
		return error('empty prompt')
	}
	if args.model.trim_space() == '' {
		return error('model required')
	}
	if args.adapter == 'deterministic' {
		return AiChatResult{ ok: true, output: 'echo: ' + prompt, model: args.model }
	}
	if args.adapter != 'openrouter' && args.adapter != 'openai' && args.adapter != 'anthropic' {
		return error('unknown adapter: ' + args.adapter)
	}
	env_name := ai_env_for_adapter(args.adapter)
	key := os.getenv_opt(env_name) or { '' }
	if key == '' {
		return error(args.adapter + ': missing ' + env_name + ' (server env only — add it to .env)')
	}
	return ai_call_provider(args, key)
}

fn ai_call_provider(args AiChatArgs, key string) !AiChatResult {
	if args.adapter == 'anthropic' {
		return ai_call_anthropic(args, key)
	}
	return ai_call_openai_compat(args, key)
}

fn ai_call_openai_compat(args AiChatArgs, key string) !AiChatResult {
	url := ai_base_url_for_adapter(args.adapter) + if args.adapter == 'openrouter' {
		'/chat/completions'
	} else {
		'/responses'
	}
	body := if args.adapter == 'openrouter' { ai_openrouter_body(args) } else { ai_openai_body(args) }
	mut header := http.new_header(key: .content_type, value: 'application/json')
	header.add(.authorization, 'Bearer ' + key)
	if args.adapter == 'openrouter' {
		header.add_custom('HTTP-Referer', 'http://localhost/') or {}
		header.add_custom('X-Title', 'swelte-shell') or {}
	}
	http_resp := http.fetch(url: url, method: .post, header: header, data: body) or {
		return error(args.adapter + ': request failed: ' + err.msg())
	}
	if http_resp.status_code != 200 {
		return error(args.adapter + ': HTTP ' + http_resp.status_code.str())
	}
	text := ai_extract_text_blobs(http_resp.body)
	if text == '' {
		return error(args.adapter + ': empty reply')
	}
	return AiChatResult{ ok: true, output: text, model: args.model }
}

fn ai_openrouter_body(args AiChatArgs) string {
	mut messages := ''
	if args.system.trim_space() != '' {
		messages = '{"role":"system","content":' + json.encode(args.system) + '},'
	}
	messages += '{"role":"user","content":' + json.encode(args.prompt) + '}'
	mut extra := ''
	if args.max_tokens > 0 {
		extra += ',"max_tokens":' + args.max_tokens.str()
	}
	if args.temperature >= 0 {
		extra += ',"temperature":' + args.temperature.str()
	}
	return '{"model":' + json.encode(args.model) + ',"messages":[' + messages + ']' + extra + '}'
}

fn ai_openai_body(args AiChatArgs) string {
	mut input := ''
	if args.system.trim_space() != '' {
		input = '{"role":"system","content":' + json.encode(args.system) + '},'
	}
	input += '{"role":"user","content":' + json.encode(args.prompt) + '}'
	mut extra := ''
	if args.max_tokens > 0 {
		extra += ',"max_output_tokens":' + args.max_tokens.str()
	}
	if args.temperature >= 0 {
		extra += ',"temperature":' + args.temperature.str()
	}
	return '{"model":' + json.encode(args.model) + ',"input":[' + input + ']' + extra + '}'
}

// JSON string unescape for the demo substring scans (`\"` → `"`,
// `\\` → `\`, `\n` → newline, …). Single pass, no allocation beyond out.
fn ai_json_unescape(raw string) string {
	mut out := []u8{cap: raw.len}
	mut i := 0
	for i < raw.len {
		c := raw[i]
		if c != `\\` || i + 1 >= raw.len {
			out << c
			i++
			continue
		}
		n := raw[i + 1]
		if n == `n` {
			out << `\n`
		} else if n == `t` {
			out << `\t`
		} else if n == `r` {
			out << `\r`
		} else if n == `"` {
			out << `"`
		} else if n == `\\` {
			out << `\\`
		} else if n == `/` {
			out << `/`
		} else {
			out << c
			out << n
		}
		i += 2
	}
	return out.bytestr()
}

// Substring scan for `"content":"…"` / `"text":"…"` blobs —
// no full JSON decode needed for the demo path. Values are JSON-unescaped
// (`\n` → newline), never returned raw.
fn ai_extract_text_blobs(body string) string {
	for needle in ['"content":"', '"text":"'] {
		mut rest := body
		for {
			idx := rest.index(needle) or { break }
			rest = rest[idx + needle.len..]
			// Walk to the closing quote honoring `\"` escapes.
			mut j := 0
			for j < rest.len {
				if rest[j] == `\\` {
					j += 2
					continue
				}
				if rest[j] == `"` {
					break
				}
				j++
			}
			if j >= rest.len {
				break
			}
			raw := rest[..j]
			rest = rest[j + 1..]
			if raw != '' {
				return ai_json_unescape(raw)
			}
		}
	}
	return ''
}

fn ai_call_anthropic(args AiChatArgs, key string) !AiChatResult {
	url := ai_base_url_for_adapter('anthropic') + '/v1/messages'
	max_tokens := if args.max_tokens > 0 { args.max_tokens } else { 1024 }
	mut body := '{"model":' + json.encode(args.model) + ',"max_tokens":' + max_tokens.str() + ',"messages":[{"role":"user","content":' + json.encode(args.prompt) + '}]'
	if args.system.trim_space() != '' {
		body += ',"system":' + json.encode(args.system)
	}
	if args.temperature >= 0 {
		body += ',"temperature":' + args.temperature.str()
	}
	body += '}'
	mut header := http.new_header(key: .content_type, value: 'application/json')
	header.add_custom('x-api-key', key) or {}
	header.add_custom('anthropic-version', '2023-06-01') or {}
	http_resp := http.fetch(url: url, method: .post, header: header, data: body) or {
		return error('anthropic: request failed: ' + err.msg())
	}
	if http_resp.status_code != 200 {
		return error('anthropic: HTTP ' + http_resp.status_code.str())
	}
	text := ai_extract_text_blobs(http_resp.body)
	if text == '' {
		return error('anthropic: empty reply')
	}
	return AiChatResult{ ok: true, output: text, model: args.model }
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