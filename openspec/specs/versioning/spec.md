# Package versioning specification

## Purpose

Keep Swelte packages on a shared major/minor release line while allowing each
package to publish independent patch revisions. In `major.minor.patch`, the
patch component is the package-specific revision.

## Requirements

### Requirement: Shared release line

All active Swelte packages SHALL share the same major and minor version.

#### Scenario: Coordinated minor release

- **WHEN** the release line advances from `0.2` to `0.3`
- **THEN** all active packages move to `0.3.0` together

### Requirement: Independent patch revisions

Each package SHALL increment its patch revision independently. Updating one
package SHALL NOT require incrementing unrelated package versions.

#### Scenario: Package-only fix

- **WHEN** core `0.2.3` receives a package-only fix while AI is `0.2.7`
- **THEN** core can advance to `0.2.4` while AI stays at `0.2.7`
- **AND** both remain on the shared `0.2` release line

### Requirement: Explicit coordinated cuts

Release tooling SHALL distinguish a package patch from a coordinated release-line
cut and SHALL reject release-line changes in ordinary single-package mode.

#### Scenario: Release line changed in single-package mode

- **WHEN** a package changes its minor version during an ordinary patch release
- **THEN** the registry gate refuses it and requires coordinated line-cut mode

## Release commands

[Release tooling](../../../scripts/sync-version.mjs) implements the policy:

```sh
node scripts/sync-version.mjs patch core      # increment core's patch only
node scripts/sync-version.mjs line-cut 0.3    # move all active packages to 0.3.0
node scripts/sync-version.mjs plan --json     # inspect selected artifacts
```

The [publishing workflow](../../../.github/workflows/publish-engine.yml) checks
registry state before publishing selected packages. This policy does not require
matching patch revisions or publishing every package for each fix.
