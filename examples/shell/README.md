# `examples/shell` — one shared backend shell, chat + terminal

A `@swelte/ai` consumer example (never published as a library). One allowlisted
backend shell (`echo pwd whoami help`) is shared by two faces:

- `/shell/ai` **terminal pane** — human keystrokes run instantly over `@[rpc]`
  `exec` / `send_input`, with live output over `@[sse] stream` or `@[ws] term`;
- `/shell/ai` **chat pane** — the `DeterministicAdapter` echoes text straight back
  while `DraftStore` + `RunTracker` + `createMemorySink` show the `@swelte/ai`
  building blocks (progressive card, turn lifecycle, trace).

AI-proposed commands never run directly: `authorizeShellCall('ai', …)` marks them
`needsApproval`, the first `exec(caller: 'ai')` call parks a `pending` record, and
the approval queue (`approve` / `deny` + `ApprovalStore`) executes exactly once —
duplicates replay the receipt, expiries deny.

The frontend gate lives in `src/lib/shell.ts` (plain TS, offline-testable); the
authoritative allowlist + approval records live in the route backend
(`src/routes/shell/ai/+page.v`).

```sh
npm install
npx swelte dev     # :5174 + V backend :8131 — open /shell/ai
npm test           # offline unit suite (no backend needed)
npx swelte build && npx swelte preview
```
