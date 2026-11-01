# Spec: skill pack — end product + maintenance contract

The skill pack lives in `.agents/skills/` (VS Code discovery path).
Five skills, each a `SKILL.md` following the [Agent Skills spec](https://agentskills.io/specification.md)
(`name` = directory name, `description` = trigger keywords).

## The pack

| skill | covers | stable sources | spec dependency |
|---|---|---|---|
| `swelte-overview` | layout, CLI, SPA-first proxy | `docs/README.md`, `docs/example.md`, `docs/versus.md`, `README.md` | none — do not touch on spec changes |
| `swelte-v-routes` | attributes, `SwelteRequest`, type table, errors, WASM purity, matchers, hooks, fail/deserialize | `docs/rpc.md`, `docs/types.md`, `docs/errors.md`, `docs/forms.md`, `docs/config.md` | `specs/moar.md` (`@[cron]`, `@[queue]`), `specs/sveltekit.md` (`ssr=false`) |
| `swelte-svelte5` | runes, imports, SSR component rule, `+error` | `docs/example.md`, `docs/ssr.md` | `specs/sveltekit.md` §§1–2, 5 (client router, streaming, server `fetch`, `use:enhance`) |
| `swelte-ssr-load` | ownership, request path, `@[load]` cascade, budgets | `docs/ssr.md`, `docs/internal/load.md`, `docs/rpc.md` | `specs/ssr.md`, `specs/sveltekit.md` §4 (`ssr=false`) |
| `swelte-sveltekit-delta` | open parity gaps, remaining work | `docs/versus.md` (stable) | `specs/sveltekit.md` + `specs/moar.md` wholesale |

## Rule

`docs/` root is stable: a skill citing only root docs never needs a
spec-driven update. Every skill section derived from `docs/specs/*`
carries a `## Spec dependency` / `⚠️` marker naming the exact spec
file + item, so the skill can be refreshed when the spec lands.
`swelte-sveltekit-delta` is fully spec-derived — re-read both specs
on every use.

## When a spec item lands

1. Move the behavior description into the relevant `docs/*.md` root file.
2. Update the dependent skill: replace the `⚠️` pointer with the stable rule.
3. Mark the spec item done (or delete it from the spec).
