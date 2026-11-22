// Tool demo route: per-run selection over the generated dispatcher.
// `GET /api/tools` runs both tools; `?only=top` or `?only=short` runs one.
// `?only=nope` selects nothing — the unselected tool stays unavailable.
// Selection is bound at the dispatch boundary: the allowlist travels with
// every call, so an unlisted tool name fails before any V fn runs.
module api_tools

import json
import tools

const top_name = 'backend.shell_tools.tool_top_commands'

const short_name = 'backend.shell_tools.tool_shorten'

fn run_selected(allowed []string, name string, args_json string) string {
	res := tools.swelte_tool_dispatch(allowed, name, args_json) or {
		return '{"ok":false,"error":"' + err.msg() + '"}'
	}
	return '{"ok":true,"tool":"' + name + '","result":' + res + '}'
}

@[get]
pub fn tools_demo(req SwelteRequest) string {
	only := req.query['only'] or { '' }
	if only == 'top' {
		return run_selected([top_name], top_name, '{"limit":2}')
	}
	if only == 'short' {
		return run_selected([short_name], short_name, '{"text":"hello shell","limit":5}')
	}
	if only == 'nope' {
		return run_selected([]string{}, 'backend.shell_tools.tool_nope', '{}')
	}
	top := run_selected([top_name, short_name], top_name, '{"limit":2}')
	short := run_selected([top_name, short_name], short_name, '{"text":"hello shell","limit":5}')
	return '{"ok":true,"top":' + top + ',"short":' + short + '}'
}
