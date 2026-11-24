# Build-time images specification

## Purpose

Generate bounded, project-local WebP image variants and metadata.

See the [reference guide](reference.md) for detailed interfaces, examples and implementation notes.

## Requirements

### Requirement: Confined bounded transforms

Image sources SHALL remain physically inside the project, including symlinks; variants SHALL preserve aspect ratio, avoid upscaling and obey the documented bounds.

#### Scenario: Confined bounded transforms behavior

- **WHEN** a configured image source escapes the project through a symlink
- **THEN** the build rejects the source

### Requirement: Shared image metadata

Generated image metadata SHALL expose ascending-width WebP variants to both client and SSR modules.

#### Scenario: Shared image metadata behavior

- **WHEN** no images are configured
- **THEN** the image module exports an empty object

