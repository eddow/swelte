# Proposed package versioning policy

## Shared major/minor release lines, independent patches

Treat `0.2`, for example, as a Swelte compatibility line. Each public package owns its patch counter within that line. A release entry identifies the affected package, the reason and the required bump. Build and test dependencies and consumers as needed. Publish the packages whose artifacts or declared compatibility changed.

Suppose core is at `0.2.4`, Plus at `0.2.1` and MCP at `0.2.0`. A core bug fix publishes core `0.2.5` alone. A plugin can still require at least core `0.2.4` when it uses a fix introduced there. Test the declared minimum and the latest compatible patch. Matching major/minor numbers do not establish compatibility by themselves.

## What happens at the next minor?

Strict synchronization gives every active package a release on the new line. This makes “install any Swelte package at 0.3” a reliable instruction, at the cost of publishing unchanged packages once per major/minor transition. A lazy transition lets a package stay on its last published line until its artifacts or compatibility metadata change. This avoids ceremonial releases, but consumers need the package's declared ranges or a tested install recipe to select compatible versions.

Prefer strict transitions for the common release line if the project wants that installation promise. Decide which packages participate before cutting the line. Private experiments sit outside the active roster. Stable independent tools could follow their own cadence if the project explicitly exempts them. A package-specific feature that warrants a minor bump triggers a line decision; disguising the feature as a patch would defeat the policy. While Swelte is at 0.x, document breaking changes at minor boundaries and preserve compatibility within a line.

## Migration and checks

The current [sync script](../../scripts/sync-version.mjs) rewrites engine versions and their internal ranges. The [publish workflow](../../.github/workflows/publish-engine.yml) covers every active workspace (builds vvm / core / plus / mcp / ssr-qjs / create, packages ai). The scaffolder also derives generated dependencies from its own version. An independent create patch must never generate a minimum core or SSR version that was never published. Give templates explicit tested dependency ranges.

Separate patch selection from a coordinated line cut. Preserve existing published versions, review internal dependency floors individually, and dry-run the publish plan in dependency order. Verify three cases before switching: a single-package patch selects one tarball, a docs-only change selects none, and a coordinated minor cut selects every active participant exactly once.

## Registry gate (publish workflow)

`node scripts/sync-version.mjs check --mode <single|line-cut> [--packages "..."]` diffs each workspace version against npm before anything builds:

- the plan preview and the publish step consume the same gate output — the reviewed list is the published list (`plan` remains a local git-status heuristic for authors);
- workspace ahead on the same line → publish (both modes: an independent patch);
- same version, or exact version already on the registry under any dist-tag → skip (green no-op, never republish — retrying a partial `next`-tagged release skips finished packages instead of failing on them);
- workspace behind → refuse both modes (stale checkout);
- line change (`major.minor` differs) → **refused in `single`, allowed in `line-cut`** — but only when every active participant shares the new line;
- never published (`E404`) → allow (first release);
- unknown names → always refused; ANY nonempty refused list fails the command; registry unreachable → fail closed.

A line cut prepares package versions, dependency ranges and scaffold minimums in memory and validates them before writing manifests. Ordinary sync and patch commands preserve reviewed internal ranges. The scaffolder reads its tested minimums from its own published package manifest. The publish gate repeats the compatibility checks and rejects stale checkouts before considering tagged-release retries.
