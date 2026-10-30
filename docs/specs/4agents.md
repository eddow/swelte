# Tools for agents

## 1. The @swelte/mcp-server (Model Context Protocol)
An official MCP server would give IDE agents direct, programmatic insight into a Swelte project's architecture rather than forcing them to guess based on raw text files.

What it exposes:

Route Tree Inspection: A tool that lets the AI query the current src/routes/ manifest, showing how +route.v files map to .svelte frontend components and dynamic parameters ([id]).

Schema & Type Bridge: Exposes the data contract between V backend responses (SwelteRequest / data loaders) and Svelte 5 $props() types.

Build Diagnostics: Hooks into Vite and V compilation logs to feed errors straight back into the agent context if a build fails.

## 2. Specialized V-Backend & Svelte 5 Skill Packs
AI models frequently hallucinate V syntax (confusing V’s `mut` keyword, struct attributes like `@[get]`, or veb routing patterns with other languages). You can provide specialized system prompt guidelines or package them as downloadable agent skills:

swelte-v-syntax-guide.md: A comprehensive reference sheet injected into agent system prompts teaching the model:

V’s memory management and immutability rules (everything is immutable by default unless marked `mut`).

How veb route handlers and context objects (veb.Context) work.

The strict constraints of the QuickJS environment (no fetch, no async/await, pure synchronous sync functions only).

Svelte 5 Runes Guardrails: Clear rules on using modern Svelte 5 runes ($state, $props, $derived, snippets) instead of legacy Svelte 3/4 syntax (export let props).