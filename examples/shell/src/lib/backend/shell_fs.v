// Sandboxed filesystem shell for the agentic shell example
// (`openspec/specs/shell-console/spec.md`). `module backend`: same module as
// `shell_tools.v`, so the route (`+page.v`, module shell) and the AI tool
// (`tool_shell_exec`) share one real implementation — no shell-out, no
// subprocess, only native `os` reads + a KV-tracked cwd jailed to the
// project root. Destructive / unlisted commands never run: they return an
// honest `unsupported command` message instead.
module backend

import os

// KV keys: pinned sandbox root (server cwd at first use) + live cwd.
pub const shell_fs_root_key = 'shell:root'
pub const shell_cwd_key = 'shell:cwd'
// Output cap per command (bytes); the scrollback rows truncate at 1024
// separately in `tool_shell_read_output` / the SSE tail.
const shell_out_cap = 4096

// First arg of a command line (`cat README.md` → `README.md`), or ''.
pub fn shell_arg(cmd string) string {
	idx := cmd.trim_space().index(' ') or { return '' }
	return cmd.trim_space()[idx + 1..].trim_space()
}

// Command name (first whitespace-separated token), or ''.
pub fn shell_cmd_name(cmd string) string {
	parts := cmd.trim_space().split(' ')
	if parts.len == 0 {
		return ''
	}
	return parts[0]
}

// Sandbox root: server working dir at first use, pinned in KV so a later
// cwd change can never widen the jail.
pub fn shell_root() string {
	pinned := kv_get(shell_fs_root_key) or { '' }
	if pinned != '' {
		return pinned
	}
	root := os.real_path(os.getwd())
	kv_set(shell_fs_root_key, root) or {}
	return root
}

// Live working directory (absolute, always inside the root).
pub fn shell_cwd() string {
	cwd := kv_get(shell_cwd_key) or { '' }
	if cwd == '' {
		return shell_root()
	}
	return cwd
}

pub fn shell_set_cwd(dir string) {
	kv_set(shell_cwd_key, dir) or {}
}

// Lexical absolute-path normalization (no FS touch).
fn shell_normalize(abs string) string {
	mut parts := []string{}
	for seg in abs.split('/') {
		if seg == '' || seg == '.' {
			continue
		}
		if seg == '..' {
			if parts.len > 0 {
				parts.pop()
			}
			continue
		}
		parts << seg
	}
	return '/' + parts.join('/')
}

// Resolve a user arg against the cwd, jailed to the sandbox root.
// Bare arg ('', `.`) → the cwd itself. `..` at the root clamps to root;
// anything escaping the root (absolute or via `..`) is rejected.
fn shell_resolve(arg string) !string {
	root := shell_root()
	trimmed := arg.trim_space()
	base := if trimmed == '' || trimmed == '.' {
		shell_cwd()
	} else if os.is_abs_path(trimmed) {
		trimmed
	} else {
		shell_cwd() + '/' + trimmed
	}
	norm := os.real_path(shell_normalize(base))
	if norm != root && !norm.starts_with(root + '/') {
		return error('outside sandbox: ' + trimmed)
	}
	return norm
}

fn shell_fs_ls(arg string) string {
	target := shell_resolve(arg) or { return 'ls: ' + err.msg() }
	entries := os.ls(target) or { return 'ls: cannot list ' + (if arg == '' { '.' } else { arg }) }
	mut sorted := entries.clone()
	sorted.sort()
	mut out := []string{}
	for e in sorted {
		full := if target == '/' { '/' + e } else { target + '/' + e }
		if os.is_dir(full) {
			out << e + '/'
		} else {
			out << e
		}
	}
	return out.join('\n')
}

fn shell_fs_cd(arg string) string {
	if arg == '' {
		shell_set_cwd(shell_root())
		return shell_root()
	}
	target := shell_resolve(arg) or { return 'cd: ' + err.msg() }
	if !os.is_dir(target) {
		return 'cd: not a directory: ' + arg
	}
	shell_set_cwd(target)
	return target
}

fn shell_fs_cat_file(arg string) string {
	if arg == '' {
		return ''
	}
	target := shell_resolve(arg) or { return 'cat: ' + err.msg() }
	if os.is_dir(target) {
		return 'cat: is a directory: ' + arg
	}
	if os.file_size(target) > u64(shell_out_cap) {
		return 'cat: file too large (>' + shell_out_cap.str() + 'B)'
	}
	return os.read_file(target) or { 'cat: cannot read ' + arg }
}

pub fn shell_fs_trunc(s string) string {
	if s.len <= shell_out_cap {
		return s
	}
	return s[..shell_out_cap] + '…[truncated]'
}

// Full command run (no stdin): echo/pwd/whoami/help/ls/cd/cat-file.
// Unknown names return an honest `unsupported command` message — never a
// fake `ran:` and never an execution.
pub fn shell_fs_run(cmd string) string {
	trimmed := cmd.trim_space()
	name := shell_cmd_name(trimmed)
	arg := shell_arg(trimmed)
	if name == 'echo' {
		return arg
	}
	if name == 'pwd' {
		return shell_cwd()
	}
	if name == 'whoami' {
		return 'swelte-shell'
	}
	if name == 'help' {
		return 'commands: echo pwd whoami help ls cd cat <file>  (sandboxed to the project root; bare cat reads stdin)'
	}
	if name == 'ls' {
		return shell_fs_trunc(shell_fs_ls(arg))
	}
	if name == 'cd' {
		return shell_fs_cd(arg)
	}
	if name == 'cat' {
		if arg == '' {
			return '(stdin arrives over the live room)'
		}
		return shell_fs_trunc(shell_fs_cat_file(arg))
	}
	return 'unsupported command: ' + name + ' (try help)'
}
