# Project and Local Policy Extensions

Project policy may define roots, repository identity, generated-output paths, context packs, continuity, work IDs, workflow, architecture, validation, Git authority, release procedure, runtime restrictions, security, and reporting.

A policy applies only to its verified scope. It may specialize or strengthen global rules, never silently weaken immutable safety, truth, ownership, permission, tenancy, data-boundary, destructive-operation, validation, or evidence controls.

Resolve exact project identity before loading. A generic local index may identify an ignored organization policy and one matching project policy. Load only that dependency closure; never enumerate or preload unrelated local policy. A repository-owned `AGENTS.md` remains the most-specific project layer within higher immutable controls.

Keep private operator, organization, project, machine, and deployment policy untracked. Do not copy, publish, stage, or modify target repositories merely to deliver local policy.

Any explicit publisher must preserve unrelated state, refuse unexplained drift, and report actual scope and outcome.

## Machine Roots

The router reads `~/.codex/governance-machine-profile.json` by default; `ACG_MACHINE_PROFILE` overrides it. Store exact mutation-capable roots in `project_roots` and exact inspection-only dependency or reuse roots in `project_read_roots`.

Use `profile add-root` for an authorized repository or worktree where project mutation may occur. Use `profile add-read-root` for an authorized external repository that may only be inspected. Read roots never authorize mutation mode; add only that root and retry once. Never authorize a broad parent for convenience.

For an explicitly requested read-only Git repository, the router may verify the
canonical worktree and its Git common directory. A worktree derived from one
registered project repository is then inspectable even when its filesystem
location differs. This Git-lineage exception never authorizes mutation,
profile writes, cleanup, a sensitive root, a symlink target, an unrelated
registered project, or ambiguous project lineage. An unbound repository is
inspectable only when its verified worktree root itself is named; descendant
paths still require a narrow project/read-root binding.

Codex owns cleanup of Codex-created task worktrees. Agent System owns cleanup
only of an Agent-System-prepared worktree receipt it created and only through
its scoped helper lifecycle. Read-only Git lineage grants neither cleanup
authority nor ownership transfer.

## Explicit Projectless Read-Only Fallback

`--project null` is an inspect-only `projectless_unbound` sentinel, never an
alias for a configured project or canonical projectless identity. It is
available only for a narrow generated directory that has no overlap or
ancestor/descendant relation with any registered or sensitive root. Missing
`--project`, and `--project null` on every command other than inspect, are
invalid.

Suppress reporting only for the expected absence of a registered root after
that eligibility check. Do not automatically add a machine-profile root,
mutate machine configuration, or wait for Agent System recovery. Immediately
issue a direct native read-only prompt naming the exact directory and requested
inspection; its result is limited to observations and labels actual model and
reasoning `Unverified`.

Registered or ambiguous binding, privacy denial, mutation, and independent
runtime defects remain governed and reportable through their normal treatment.
