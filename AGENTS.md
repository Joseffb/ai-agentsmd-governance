# AI Codex Governance Repository

This repository is the authoritative source for Agent System, a modular JIT
orchestration and agent-use governance system.

## Scope

Keep the tracked tree portable and publication-safe. Do not commit personal paths, operator profiles, organization or project identities, private repository metadata, secrets, imported private policies, or local deployment targets. Store those only in ignored local extensions.

Tracked policy consists of the kernel, manifest, generic modules, schemas, router, skill, neutral fixtures, and tests. Runtime releases are derived artifacts.

The canonical public identity is `docs/agent-system-role.md`. Agent System
dynamically loads the smallest applicable rule set, composes scoped worker
prompts, selects model and reasoning, and enforces delegation so Seat `0`
remains the high-level orchestrator. It governs agent use and prompt
activation, never project authority, project state, releases, deployment,
publication, or business execution. An Agent System failure never blocks the
project.

Fresh installation consent is separate for persistent Agent System task
maintenance, governance/runtime defect reporting, and repair. Missing or
disabled repair consent means no repair. `log_only` records every eligible
Agent System/runtime issue and never repairs; opted-in `auto_correct` repairs
only confirmed, locally actionable true Agent System blockers and logs all
other issues without repair. A true blocker is an Observed/Verified P0/P1
defect disabling a required core Agent System capability within private Agent
System scope with no equivalent supported repair path; it excludes project and
caller defects, runtime-only limitations, destructive or irreversible changes,
architecture/public-contract redesign, source-project mutation, public
publication, and schedule. The source project continues through fallback and
never waits. No repair disposition authorizes KPI automation.

## Change Contract

Before changing policy:

1. Identify the canonical rule owner.
2. Search for semantic duplicates and contradictions.
3. Preserve normative strength, scope, exceptions, evidence, and failure behavior.
4. Keep detailed rules in one module; keep the always-loaded kernel at or below
   its 2,000 estimated-policy-token target.
5. Load only policy required for the immediate operation.
6. Update digests and run authoritative policy validation.
7. Never edit an active runtime symlink as the source of truth.

Local organization and project policies are private extensions. They must remain ignored, digest-verified, and lazily loaded through the generic local-policy index.

Git commits, pushes, releases, activation, and history rewriting require applicable user and repository authority.
