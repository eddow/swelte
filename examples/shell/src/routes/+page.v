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
	return swelte_stream({'Content-Type': 'text/event-stream'}, fn [run_id, adapter, model, prompt, temperature, max_tokens, system] (stream SwelteStream) ! {
		ai_stream_run(stream, run_id, adapter, model, prompt, temperature, max_tokens, system)
	})
}

fn ai_sse_emit(stream SwelteStream, run_id string, output_id string, kind string, seq int, payload string) bool {
	msg := 'event: ' + kind + '\ndata: {"envelope":{"runId":"' + run_id + '","outputId":"' + output_id + '","kind":"' + kind + '","seq":' + seq.str() + '},"payload":' + payload + '}\n\n'
	return stream.write(msg.bytes())
}

fn ai_stream_run(stream SwelteStream, run_id string, adapter string, model string, prompt string, temperature f64, max_tokens int, system string) {
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
		ai_sse_terminal(stream, mut ctx, 'completed', '')
		return
	}
	env_name := ai_env_for_adapter(adapter)
	key := os.getenv_opt(env_name) or { '' }
	if key == '' {
		ai_sse_terminal(stream, mut ctx, 'failed', adapter + ': missing ' + env_name + ' (server env only — add it to .env)')
		return
	}
	ok := ai_stream_provider(stream, mut ctx, adapter, model, prompt, temperature, max_tokens, system, key) or {
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

fn ai_stream_provider(stream SwelteStream, mut ctx AiStreamCtx, adapter string, model string, prompt string, temperature f64, max_tokens int, system string, key string) !bool {
	if adapter == 'openrouter' {
		body := '{"model":' + json.encode(model) + ',"stream":true,"stream_options":{"include_usage":true},"messages":[' + ai_msg_list(prompt, system) + ']' + ai_openrouter_extra(temperature, max_tokens) + '}'
		return ai_stream_sse_post(stream, 'https://openrouter.ai/api/v1/chat/completions', key, adapter, body, mut ctx)
	}
	if adapter == 'openai' {
		body := '{"model":' + json.encode(model) + ',"stream":true,"input":[' + ai_msg_list(prompt, system) + ']' + ai_openai_extra(temperature, max_tokens) + '}'
		mut header := http.new_header(key: .authorization, value: 'Bearer ' + key)
		header.add(.content_type, 'application/json')
		return ai_stream_fetch(stream, 'https://api.openai.com/v1/responses', header, body, adapter, mut ctx)
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
	return ai_stream_fetch(stream, 'https://api.anthropic.com/v1/messages', header, body, adapter, mut ctx)
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
// reply below when their SSE shape differs.
fn ai_stream_sse_post(stream SwelteStream, url string, key string, adapter string, body string, mut ctx AiStreamCtx) !bool {
	resp := http.fetch(url: url, method: .post, header: ai_bearer_json(key, adapter), data: body) or {
		return error(adapter + ': request failed: ' + err.msg())
	}
	if resp.status_code != 200 {
		return error(adapter + ': HTTP ' + resp.status_code.str())
	}
	mut pending := resp.body
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
			if !ai_sse_delta(stream, mut ctx, chunk) {
				return false
			}
		}
	}
	return true
}

// Non-SSE providers: split the full reply into chunks so the pane still
// paints incrementally instead of wait-then-all.
fn ai_stream_fetch(stream SwelteStream, url string, header http.Header, body string, adapter string, mut ctx AiStreamCtx) !bool {
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
				return false
			}
			rest = rest[cut..]
		}
	}
	return true
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