# Swelte specifications and plans

Current behavioral contracts live in `specs/<capability>/spec.md`. Detailed
interfaces and examples live alongside each contract in `reference.md`.
Design notes and measured results are labelled separately; they are not new
requirements or promises of unimplemented features.

## Current capabilities

- [RPC and V imports](specs/rpc/spec.md) · [reference](specs/rpc/reference.md) · [import design history](specs/rpc/import-design.md)
- [Type projection](specs/type-projection/spec.md) · [reference](specs/type-projection/reference.md)
- [Errors](specs/errors/spec.md) · [reference](specs/errors/reference.md)
- [Configuration](specs/configuration/spec.md) · [reference](specs/configuration/reference.md)
- [Page lifecycle](specs/page-lifecycle/spec.md) · [reference](specs/page-lifecycle/reference.md) · [load design](specs/page-lifecycle/load-design.md)
- [Forms](specs/forms/spec.md) · [reference](specs/forms/reference.md)
- [SSR](specs/ssr/spec.md) · [reference](specs/ssr/reference.md)
- [Native streams](specs/streaming/spec.md) · [reference](specs/streaming/reference.md)
- [Native lifecycle](specs/native-lifecycle/spec.md) · [reference](specs/native-lifecycle/reference.md) · [fixture measurements](specs/native-lifecycle/measurements.md)
- [Library packaging](specs/library-packaging/spec.md) · [reference](specs/library-packaging/reference.md)
- [npm V libraries](specs/npm-v-libraries/spec.md) · [reference](specs/npm-v-libraries/reference.md)
- [Plus plugins](specs/plus/spec.md) · [reference](specs/plus/reference.md)
- [Build-time images](specs/images/spec.md) · [reference](specs/images/reference.md)
- [Offline outbox](specs/offline-outbox/spec.md) · [reference](specs/offline-outbox/reference.md)
- [CLI](specs/command-line/spec.md) · [reference](specs/command-line/reference.md)
- [Deployment setup](specs/deployment/spec.md) · [reference](specs/deployment/reference.md)
- [Agent tooling](specs/agent-tooling/spec.md) · [reference](specs/agent-tooling/reference.md)
- [Example application](specs/example-app/spec.md) · [reference](specs/example-app/reference.md)
- [SvelteKit compatibility](specs/sveltekit-compatibility/spec.md) · [migration guide](specs/sveltekit-compatibility/reference.md)
- [Architecture boundaries](specs/architecture/spec.md) · [positioning](specs/architecture/reference.md)
- [Shell console](specs/shell-console/spec.md) · [evidence](../examples/shell/tests/evidence/2026-11-24/README.md)

- [Package versioning](specs/versioning/spec.md) — shared minor release line, independent package patches

## Planning and changes

The remaining files in `plans/` retain the former roadmap documents. `plans/` is a
project convention, not an OpenSpec change store: its checkboxes do not make
proposals current behavior and the CLI does not validate or archive them.

New implementation work belongs in `changes/<change-name>/` with a proposal,
design, tasks and capability delta specs. Archive completed changes through
OpenSpec to merge their requirements into `specs/` and retain change history
in `changes/archive/`. This migration establishes a baseline; it does not
invent completed change histories for existing code.

```sh
openspec list --specs
openspec validate --specs --strict --no-interactive
openspec list
```

See the upstream [OpenSpec concepts](https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md)
and [getting started](https://github.com/Fission-AI/OpenSpec/blob/main/docs/getting-started.md).
Acceptance snapshots belong beside their tests, such as
[the shell evidence](../examples/shell/tests/evidence/README.md), rather than in
specs, plans or generated change artifacts.
