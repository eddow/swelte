# `examples/shell` — one shared backend shell, chat + terminal

A `@swelte/ai` consumer example (never published as a library). One allowlisted
backend shell (`echo pwd whoami help`) is shared by two faces on `/`:

- **chat pane** (left) — a ChatComposer-spirited thread plus queue: author/meta
  headers per turn, transient dimmed reply bubble that settles when the reply
  lands, send that flips to Stop (interrupt) while streaming, auto-growing
  textarea (Enter sends, Shift+Enter breaks the line, IME-safe), and a prompt
  history picker for resends; an AI-configuration picker chooses among saved
  adapter + model + run configs (configure gear adds/edits/deletes), and the
  approval queue below gates AI-proposed commands;
- **terminal pane** (right) — auto-subscribes to the backend room over SSE on
  mount (no connect buttons): type a command, Enter runs it via `@[rpc] exec`.
  The room speaks one framed protocol (`exec\n<cmd>\n<output>` / `chat\n<msg>` /
  `stdin\n<keys>`, one publish per event); the terminal renders exec frames and
  stdin echoes only, prompt and output on their own lines, deduped against the
  optimistic paint — every command/output pair displays exactly once, never
  interleaved, chat chatter never leaks in. One Compose-style prompt bar is the
  whole input: idle Enter runs, while a command runs Enter forwards keystrokes
  to its stdin (`cat` waits briefly for input, then returns it);

AI-proposed commands never run directly: `authorizeShellCall('ai', …)` marks them
`needsApproval`, the first `exec(caller: 'ai')` call parks a `pending` record, and
the approval queue (`approve` / `deny` + `ApprovalStore`) executes exactly once —
duplicates replay the receipt, expiries deny.

AI configurations (`src/lib/ai-config.ts`, persisted in `localStorage`) hold
adapter + model + run config (temperature, max tokens, system prompt) — never
API keys. Keyed adapters (`openrouter`, `openai`, `anthropic`) run server-side
through `ai_chat`/`ai_key_status` in `src/routes/+page.v`, which reads keys from
server env only; the `deterministic` adapter echoes offline through the same RPC.
Copy `.env.example` to `.env` and add keys there (`swelte dev`/`build`/`preview`
load it; real env vars win when set).

The frontend gate lives in `src/lib/shell.ts` (plain TS, offline-testable); the
authoritative allowlist + approval records live in the route backend
(`src/routes/+page.v`). Presentation follows the Baby UI docs style on the
repo's docs-site stack (daisyUI `light --default, dark` on `<html data-theme>`,
stored pref + OS default, pre-paint boot, header toggle). The page is
client-only (`src/routes/+page.ts` opts out with `export const ssr = false` —
live streams don't SSR-render).

```sh
npm install
npx swelte dev     # :5174 + V backend :8131 — open /
npm test           # offline unit suite (no backend needed)
npx swelte build && npx swelte preview
```
