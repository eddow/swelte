# Shell console

A local shared console with an assistant and a native filesystem terminal.
Copy `.env.example` to `.env`, set a provider key, and run `npm run dev`.
Keys stay on the server. Choose an adapter/model in the chat settings.

The assistant knows its tools on the first model request. It can read recent
terminal output, choose a tool when needed, and use its result to answer or
choose another tool. Each request allows up to eight model/tool steps. Recent
chat messages and a bounded terminal tail provide context for subsequent turns.
OpenRouter, OpenAI Responses and Anthropic use the same example-local text tool
protocol. Model decisions are buffered to keep tool syntax out of the chat;
progress and final answers travel over SSE. This is not native provider tool
calling or token-by-token provider streaming.

Read-only `pwd`, `whoami`, `help`, and `ls [path]` queries run directly, without
a toggle or approval. Enable the keyboard toggle beside Send to allow other shell **and browse** actions
for that turn. Every action opens the approval queue with its exact arguments.
Approve executes through the generated dispatcher and automatically asks the
model to continue using the actual result. Deny ends the parked action. Stop
aborts the chat request and releases terminal control. Human terminal commands
preempt the AI lease. Read-only queries and observations need no approval.

Supported shell commands are `echo`, `pwd`, `whoami`, `help`, `ls`, `cd`, and
`cat <file>`. Filesystem paths resolve physically within the server's initial
working directory, including symlink checks. Bare human `cat` accepts queued
stdin. This console does not launch an OS shell: arbitrary programs, pipes,
redirects, package installation and file writes are unavailable.

`tool_shell_browse` fetches an explicitly approved HTTPS URL with no credentials
or cookies, no automatic redirects, a ten second read timeout, a 64 KiB receive
limit and a 4 KiB returned-content cap. It returns status, URL and raw text/HTML.
It does not run JavaScript, search the web, click links or control a browser.
Each subsequent URL needs its own approval. Approved URLs can reach networks
accessible to the server; the HTTP reader is not a network sandbox.

The backend binds pending operations to server-generated operation and holder
IDs, tool name and exact serialized arguments. A live 90 second lease is
required to execute. A mutex serializes approval dispatch, and successful
receipts replay without running the command again. The UI never falls back to
executing a failed AI action as a human command. Side effects are unavailable
through the GET demo endpoint. Model-provided caller labels do not grant
private reporting rows.

This is a **single trusted local console**, with shared cwd, transcript, stdin
and driver state across tabs. The human POST endpoints are the authority;
there is no login or per-user identity separating people who can access the
console. The generated approval table is process-local; a restart invalidates
pending approvals, while successful KV receipts remain available. Use a new
turn after a lease expires or the server restarts.

```sh
npm test                  # offline tests and native reporting probe
npm run test:integration  # builds, then tests the compiled backend with a local provider fixture
npm run build
npm run preview
```

The integration suite uses a temporary database and sandbox. It verifies all
three keyed adapter response shapes, tool awareness, observation feedback,
approval binding, continuation, receipt replay, denial, human preemption, URL
validation, symlink confinement, and the GET approval restriction. It does not
use real model keys or exercise an external provider's model behavior.
`SHELL_AI_BASE_URL` optionally overrides the provider base URL for a local
fixture or compatible proxy; keep it unset for the standard provider endpoints.
