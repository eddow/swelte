# `examples/shell` — one shared backend shell, chat + terminal

A `@swelte/ai` consumer example (never published as a library). One allowlisted
backend shell (`echo pwd whoami help cat`) is shared by two faces on `/`:

- **chat pane** (left) — a ChatComposer-spirited thread plus queue: author/meta
  headers per turn, transient dimmed reply bubble that settles when the reply
  lands, send that flips to Stop (interrupt) while streaming, auto-growing
  textarea (Enter sends, Shift+Enter breaks the line, IME-safe), and a prompt
  history picker for resends; an AI-configuration picker chooses among saved
  adapter + model + run configs (configure gear adds/edits/deletes). The send
  box carries a "let AI use terminal this turn" scope: checked, the turn hands
  `shell:driver` to the AI (`ai:<runId/turn-1>`, 90 s TTL) and the model may
  park `shell.exec` / `shell.send_input` calls that wait for human approval;
  the approval queue below gates parked AI calls (`shell_tool_resume` /
  `shell_tool_deny` → dispatch-table decide + dispatch, holder-bound,
  replay-safe); reads (`shell.read_output`) resolve inline with no approval.
- **terminal pane** (right) — auto-subscribes to the backend room over SSE on
  mount (no connect buttons): type a command, Enter runs it via `@[rpc] exec`.
  The room speaks one framed protocol (`exec\n<cmd>\n<output>` / `chat\n<msg>` /
  `stdin\n<keys>`, one publish per event); the terminal renders exec frames and
  stdin echoes only, prompt and output on their own lines, deduped against the
  optimistic paint — every command/output pair displays exactly once, never
  interleaved, chat chatter never leaks in. One Compose-style prompt bar is the
  whole input: idle Enter runs, while a command runs Enter forwards keystrokes
  to its stdin (`cat` waits briefly for input, then returns it).

AI-proposed side effects never run without a human decision on the backend
dispatch-table record (`caller` + tool + exact args + op id):

- `authorizeShellCall('ai', …)` marks them `needsApproval` for instant UI
  feedback; the first parked AI call creates one `pending` record and the
  approval queue (`approve` / `deny` on the queued advisory record, plus
  `shell_tool_resume` / `shell_tool_deny` on the dispatch-table record for
  parked driving calls) decides exactly once — duplicates replay the stored
  result, expiries and flips deny.
- The live AI path dispatches through the generated `tools` table
  (`tool_shell_exec` / `tool_shell_send_input` holder-lease gated,
  `tool_shell_read_output` read-only). A legacy `exec(caller:'ai')` gate stays
  as the offline/test path: it fails actionably pointing at `tool_shell_exec`.
- The "AI: echo hello-from-ai" button exercises that offline path; the driving
  turn (`drive=1`) exercises the live parked path without a provider key in
  `deterministic` mode (parks `pwd` + `waiting_approval`).

Human control is preemptive: any human terminal submit or Stop press flips
`shell:driver` back to `human`, a parked in-flight call resolves
denied/superseded, and the human command runs the unchanged allowlisted path.
Next AI turn after human activity receives a transcript tail (last 5
scrollback frames, ≤1024 B) as re-entry context. Approvals are per-turn and
expire with the lease — there is no standing AI control.

AI configurations (`src/lib/ai-config.ts`, persisted in `localStorage`) hold
adapter + model + run config (temperature, max tokens, system prompt) — never
API keys. Keyed adapters (`openrouter`, `openai`, `anthropic`) run server-side
through `ai_chat`/`ai_key_status` in `src/routes/+page.v`, which reads keys from
server env only; the `deterministic` adapter echoes offline through the same RPC.
Copy `.env.example` to `.env` and add keys there (`swelte dev`/`build`/`preview`
load it; real env vars win when set).

The frontend gate lives in `src/lib/shell.ts` (plain TS, offline-testable)
with the advisory driver-lease mirror (`parseDriver` / `driverHolds`,
`DRIVER_TTL_S = 90`); the authoritative allowlist + approval
records live in the route backend (`src/routes/+page.v`) and the generated
`tools` module. Per-turn budgets: request args ≤256 B, results /
transcript tail ≤1024 B (truncation marked). Presentation follows the Baby UI
docs style on the repo's docs-site stack (daisyUI `light --default, dark` on
`<html data-theme>`, stored pref + OS default, pre-paint boot, header toggle).
The page is client-only (`src/routes/+page.ts` opts out with
`export const ssr = false` — live streams don't SSR-render).

```sh
npm install
npx swelte dev     # :5174 + V backend :8131 — open /
npm test           # offline unit suite (no backend needed)
npx swelte build && npx swelte preview
```
