// Tool demo route: per-run selection over the generated dispatcher.
// `GET /api/tools` runs the read-only tools; `?only=top` or `?only=short`
// runs one. `?only=nope` selects nothing — the unselected tool stays
// unavailable. Selection is bound at the dispatch boundary: the allowlist
// travels with every call, so an unlisted tool name fails before any V fn
// runs. Read-only tools pass no caller/op (`'',''`): no approval flow.
// `?note=<text>` exercises the side-effect arm (`tool_publish_note`):
// without `&approve=1` the gate rejects (`approval required`); with it the
// route records + approves the op and the dispatch succeeds. `&op=<id>`
// reuses the op id (duplicate delivery replays the stored result).
module api_tools

import json
import tools

const top_name = 'backend.shell_tools.tool_top_commands'

const short_name = 'backend.shell_tools.tool_shorten'

const note_name = 'backend.shell_tools.tool_publish_note'

const shell_exec_name = 'backend.shell_tools.tool_shell_exec'

const shell_input_name = 'backend.shell_tools.tool_shell_send_input'

const shell_read_name = 'backend.shell_tools.tool_shell_read_output'

fn run_selected(allowed []string, name string, args_json string, caller string, op_id string) string {
	res := tools.swelte_tool_dispatch(allowed, name, args_json, caller, op_id) or {
		return '{"ok":false,"error":"' + err.msg() + '"}'
	}
	return '{"ok":true,"tool":"' + name + '","result":' + res + '}'
}

@[get]
pub fn tools_demo(req SwelteRequest) string {
	only := req.query['only'] or { '' }
	if only == 'top' {
		// Paged reporting query: `page` windows the ranked rows, `caller`
		// selects the authorized ledger subset (public-only when absent).
		page := (req.query['page'] or { '0' }).int()
		caller := req.query['caller'] or { '' }
		args_json := '{"limit":2,"page":' + page.str() + ',"caller":' + json.encode(caller) + '}'
		return run_selected([top_name], top_name, args_json, '', '')
	}
	if only == 'short' {
		return run_selected([short_name], short_name, '{"text":"hello shell","limit":5}', '', '')
	}
	if only == 'nope' {
		return run_selected([]string{}, 'backend.shell_tools.tool_nope', '{}', '', '')
	}
	if only == 'note' || only == 'shell_exec' {
		return '{"ok":false,"error":"actions require the console POST approval flow"}'
	}
	if only == 'shell_read' {
		since := (req.query['since'] or { '0' }).int()
		limit := (req.query['limit'] or { '5' }).int()
		args_json := '{"since_seq":' + since.str() + ',"limit":' + limit.str() + '}'
		return run_selected([shell_read_name], shell_read_name, args_json, '', '')
	}
	top := run_selected([top_name, short_name], top_name, '{"limit":2}', '', '')
	short := run_selected([top_name, short_name], short_name, '{"text":"hello shell","limit":5}',
		'', '')
	return '{"ok":true,"top":' + top + ',"short":' + short + '}'
}
