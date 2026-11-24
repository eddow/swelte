# Deployment setup specification

## Purpose

Prepare deployment configuration for prebuilt application artifacts.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Setup without shipping

`swelte deploy init` SHALL generate target configuration without uploading artifacts, obtaining credentials or invoking platform deployment commands.

#### Scenario: Setup without shipping behavior

- **WHEN** a developer initializes a deployment target
- **THEN** the command writes the documented configuration and leaves shipping to the developer

### Requirement: Read-only drift checks

Deployment status/check operations SHALL report missing or drifted managed files without rewriting them.

#### Scenario: Read-only drift checks behavior

- **WHEN** a managed deployment file differs from expected output
- **THEN** the check fails with a repair hint and leaves the file unchanged

