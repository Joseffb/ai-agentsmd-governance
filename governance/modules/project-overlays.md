# Project and Local Policy Extensions

Project policy may define roots, repository identity, generated-output paths, context packs, continuity, work IDs, workflow, architecture, validation, Git authority, release procedure, runtime restrictions, security, and reporting.

A policy applies only to its verified scope. It may specialize or strengthen global rules, never silently weaken immutable safety, truth, ownership, permission, tenancy, data-boundary, destructive-operation, validation, or evidence controls.

Resolve exact project identity before loading. A generic local index may identify an ignored organization policy and one matching project policy. Load only that dependency closure; never enumerate or preload unrelated local policy. A repository-owned `AGENTS.md` remains the most-specific project layer within higher immutable controls.

Keep private operator, organization, project, machine, and deployment policy untracked. Do not copy, publish, stage, or modify target repositories merely to deliver local policy.

Any explicit publisher must preserve unrelated state, refuse unexplained drift, and report actual scope and outcome.

## Machine Roots

The router reads `~/.codex/governance-machine-profile.json` by default; `ACG_MACHINE_PROFILE` overrides it. Store exact mutation-capable roots in `project_roots` and exact inspection-only dependency or reuse roots in `project_read_roots`.

Use `profile add-root` for an authorized repository or worktree where project mutation may occur. Use `profile add-read-root` for an authorized external repository that may only be inspected. Read roots never authorize mutation mode; add only that root and retry once. Never authorize a broad parent for convenience.
