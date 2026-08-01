# AI Codex Governance Repository

This repository is the authoritative source for Agent System, a modular JIT
orchestration and agent-use governance system.

## Scope

Keep the tracked tree portable and publication-safe. Do not commit personal paths, operator profiles, organization or project identities, private repository metadata, secrets, imported private policies, or local deployment targets. Store those only in ignored local extensions.

Tracked policy consists of the kernel, manifest, generic modules, schemas, router, skill, neutral fixtures, and tests. Runtime releases are derived artifacts.

The canonical public identity is `docs/agent-system-role.md`.

**Agent System governs execution, not engineering.** It dynamically loads the
smallest applicable rule set, composes scoped worker prompts, selects model and
reasoning, and enforces worker admission only at named expensive or
irreversible boundaries. Strategy, topology, implementation, coding, and
optimization differences are observed rather than blocked.

**Agent System provides governance through evidence, not control.** Seat `0`
remains governed and auditable but is never subject to Agent System execution
enforcement. Its constraints come only from external platform and safety
requirements, valid user authority, ownership and data boundaries, destructive
ambiguity, and project release rules. An explicit user instruction that
“Seat 0 does not implement” remains user authority. Evidence, lifecycle
records, metrics, and reports never become execution authority. An Agent System
or helper failure never blocks Seat `0` or the project.

## Communication

For human-facing outputs, follow the kernel's BLUF, Pyramid Principle,
progressive-disclosure, and plain-language framework. Keep agent-to-agent
messages token-compressed but meaning-dense and operationally complete.

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

Every bounded governance/runtime incident is appended privately to local JSONL
before any delivery and classified as `agent_system`, `worker_adherence`,
`host_runtime`, `project_tool_side_effect`, `caller_error`, or
`expected_fail_closed`. Only a new confirmed `agent_system` failure class,
materially new repair-advancing evidence, or a true no-fallback P0/P1 core
blocker crosses to the persistent Agent System; repeats aggregate by failure
class and append-only corrections may reclassify them. The other categories are
not Agent System defects unless separately confirmed as `agent_system`.

After verified tracked Agent System edits are released and activated, notify
each known active project task once to reload or adopt current policy before
its next governed operation. The notice is nonblocking, resolves each task by
its current exact label without stored thread IDs, and never claims retrofitted
hooks; app Reload is required only when a plugin or hook needs host refresh.

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

Prefer observation over intervention, existing evidence over new
instrumentation, composition over a new subsystem, and deletion over new
policy. An elegance-only feature is a removal candidate. Every hard rule must
state the prevented failure, why it is expensive or irreversible, enforcement
cost, Seat `0` escalation path, and safe fallback; if it cannot pay that rent,
do not add it.

Local organization and project policies are private extensions. They must remain ignored, digest-verified, and lazily loaded through the generic local-policy index.

Git commits, pushes, releases, activation, and history rewriting require applicable user and repository authority.
