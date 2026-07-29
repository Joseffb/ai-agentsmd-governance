---
name: govern-codex-policy
description: Route, load, and manage modular Codex governance. Use before governed actions or global Codex rule changes. Ask for global, organization, or project scope when unspecified.
---

# Govern Codex Policy

The kernel bootstraps, the manifest routes, and modules own policy. This skill
controls JIT Agent-file/rule discovery and smallest-sufficient scoped prompt
composition; agent-use enforcement is the necessary execution control and
dependency-aware scheduling is a thin launch-order layer. Agent System governs prompt activation and
worker orchestration, never project authority, project state, releases,
deployment, publication, or business execution.

## Load Policy

1. Gather project, mode, phase, immediate operation, tools, paths, risks, authority, capabilities, and latest acknowledgment.
2. If an enum is uncertain, run `node ~/.codex/policies/bin/acg.mjs list all` once; never invent it.
3. Pass ignored local indexes explicitly and run `route` with strict JSON stdin.
4. Verify manifest, order, digests, advisory context targets, and receipt. Estimated policy totals never force rollover or handoff.
5. Run `deliver`, verify it, enter only its delta, then run `acknowledge --file <complete-deliver-output.json>`.
6. Re-route only when project, phase, operation, tool, path, authority, effect, or risk changes.

Never preload future phases or scan policy trees. Accounting is monotonic. A
matching local index may add only the router-returned organization policy and
one project policy; repository `AGENTS.md` remains most specific.

For inspect-only work, `--project null` is the unbound
`projectless_unbound` sentinel, not a configured project alias. It is permitted
only for a narrow generated directory with no overlap or ancestor/descendant
relation to a registered or sensitive root. A missing project, or `null` on
any non-inspect command, remains invalid. Suppress only the expected
unregistered-root absence after that check; registered/ambiguous binding,
privacy denial, mutation, and independent runtime defects remain governed and
reportable. Do not modify the machine profile or wait. Immediately send a
direct native read-only prompt with the exact directory and inspection scope;
accept observations-only results and label actual model/reasoning `Unverified`.

## JIT Orchestration

Classify only the immediate intent. Select the smallest verified rule delta,
retain every entered rule/version in the monotonic ledger, compose the
least-context worker prompt, choose the lowest reliable model and raw reasoning
level, and keep Seat `0` as the high-level orchestrator. Policy totals never
force a handoff.

Seat `0` is excluded from worker counts. Its only direct implementation
exception is exactly one explicitly atomic, low-risk correction with a known
remedy, no worker-owned slice, one source-mutation surface, delegation overhead
dominating, an estimate no greater than five AI-active minutes, and no
contract, security, privacy, dependency, migration, build, test, browser,
deployment, release, database, destructive, or authority-changing effect. A
direct user or project instruction that “Seat 0 does not implement” removes
the exception.

For substantial work, choose `PARALLEL`, `PIPELINED`, `SERIAL`, or
`EXPLORATORY` from logical dependencies and integration contracts; file
disjointness and isolated branches do not prove independent contracts. Default
delivery is: decompose, reserve independent lanes, give each mutating worker a
verified branch/worktree, have workers implement and locally test, then have
Seat `0` integrate and run authoritative validation on the integrated
candidate. Workers never merge, integrate, or touch the shared primary
worktree. Truly read-only workers need no new worktree; non-Git mutation needs
equivalent isolated mutable state. Constrain parallelism only for genuinely
tiny or tightly coupled work, unsafe overlap, unavailable capacity or tooling,
ordered dependencies, or coordination cost that truly erases benefit; state a
material constraint when useful capacity remains idle.

Topology is JIT launch-order metadata: never load broader context or create a
persistent workflow state machine for it. Uncertainty yields `SERIAL` or
`EXPLORATORY`; helper/classifier failure preserves delegation boundaries and
uses a bounded manual/native worker fallback without blocking the project.

After an Agent System/helper failure, report or local-log unchanged evidence
once according to consent, then immediately use any safe available option:
another supported high-level path, direct native collaboration, same-seat retry
only after changed conditions or a transient failure, a replacement or
rescoped worker, a bounded manual worker prompt, then project-native tooling.
Do not impose a hard retry count or repeat an unchanged launch. No fallback
grants Seat `0` substantial implementation, expands authority, or creates a
wait-for-Agent-System state. Ask only for genuine authority, destructive
ambiguity, or an absent required resource.

## Communication

Send explicitly user-approved task-to-task messages and swarm- or
delegation-authorized messages directly. Do not invoke a second route, delivery, acknowledgment, or receipt for granted authority. Preserve
recipient, project, tenancy, and data boundaries. For a new boundary, run
`acg.mjs communicate --project <slug> --target <task-id> --scope <absolute-path>`
and require `communication_authorized:true`.

## Agent System Defect Lane

When operating or bootstrapping Agent System, load and adopt the canonical
portable role at `../../docs/agent-system-role.md`. Private continuity may add
machine-local state or help discover that file, but it is not the role owner.

Agent System handles Codex governance/runtime defects, not project work. Keep project status, architecture, audit findings, and product failures in the project task. Use self-service commands first; report or local-log a registered-root, alias, stale-metadata, helper, or missing-repair defect once according to consent, preserve state, and immediately continue project work within existing authority using existing tool definitions or native tools. There is no wait-for-Agent-System state. Agent System may block an improper Seat `0` action, but it never blocks the project.

On fresh bootstrap, explicitly ask three separate decisions: whether to create
and maintain a persistent Agent System task, whether to automatically send it
governance/runtime defect reports, and whether to repair true Agent System
blockers. State that task operation, reporting, and repair can consume tokens.
Task maintenance, reporting, and repair each require their own explicit active
consent. Automatic reporting additionally requires an active task lane and a
`log_only` or `auto_correct` disposition. Missing, disabled, undecided,
inactive, or local-only repair consent means no repair. With any required
consent absent, undecided, inactive, or local-only, do not perform that
capability or spend background tokens. For an inactive or
local-only reporting disposition, use only a quiet bounded secret-free append
to a private untracked local JSONL issue ledger; it is not a message and never
wakes or creates a task.

Record fresh or legacy consent only with:

`node ~/.codex/policies/bin/acg.mjs profile agent-system --persistent-task yes|no --automatic-defect-report yes|no --automatic-repair yes|no [--reported-defect-action log_only|auto_correct] --acknowledge-agent-system-token-cost --authorize-profile-write [--label <exact-title>] [--memory <optional-private-file>]`

`--memory` is optional machine-local continuity; the tracked
`../../docs/agent-system-role.md` remains canonical.
`--reported-defect-action` is required when `--automatic-defect-report yes` and
rejected when it is `no`. `--automatic-repair` records a distinct repair
decision; missing, disabled, or inactive repair consent never starts repair.
Legacy combined reporting consent migrates to `log_only` and never authorizes
automatic KPI or after-action reports or automatic repair. `log_only` records
every eligible Agent System/runtime issue and never starts repair. Opted-in
`auto_correct` is the active System Agent repair mode: it automatically repairs
only a confirmed, locally actionable true Agent System blocker and logs every
other issue without repair. When automatic defect reporting is not enabled, write the
local-only ledger entry only with:

`node ~/.codex/policies/bin/acg.mjs agent-system record-issue --project <slug> --issue-id <id> --severity P0|P1|P2|P3|P4 --summary <bounded-text> [--evidence-class Observed|Inferred|Proposed|Unknown|Unverified] [--evidence <bounded-text>]`

That command is permitted only when automatic reporting is not enabled; an
active persistent task with reporting declined is local-only for reports.

For an explicitly configured active lane, preserve state and run `acg.mjs
profile agent-system`. Resolve the current target at delivery time from its
configured label: list current tasks, filter out archived tasks, require one
exact title match, then use the runtime-returned thread ID only for that
delivery. Never route by a stored thread ID; Agent System tasks may be replaced
or archived. Fail closed on multiple matches. If no match exists, auto-create
one labeled task only when explicitly enabled, relist once, otherwise ask.
When `auto_report` is true, send one secret-free symptom/evidence/disposition
payload without another operator prompt. Continue project work immediately;
never wait for Agent System or resend unchanged evidence. Existing explicitly
configured installations remain compatible through `log_only`. Failing to send
when configured is an Agent System adherence defect, not a project blocker.

A true blocker is an Observed/Verified P0/P1 defect that disables a required
core Agent System capability, is locally actionable within private Agent System
scope, and has no equivalent supported repair path that restores that
capability. It is not a project defect, caller syntax error, external
runtime-only limitation, destructive/irreversible change,
architecture/public-contract redesign, source-project mutation, public
publication, or schedule. `auto_correct` can act only on private Agent System
code, configuration, worktrees, and private release lanes under existing
authority. It cannot mutate the reporting project, its continuity, or any
public branch. It never grants merge, push, activation, publication, or release
authority. The source project never waits and continues through fallback.

When intentionally replacing the Agent System task, stage the replacement
under a temporary noncanonical title such as `Agent System - Incoming`. Keep
the predecessor canonical until the replacement is ready; then rename and
unpin the predecessor, pin the replacement, assign the exact `Agent System`
label to the replacement, and verify one non-archived exact match. Topmost
pinned ordering is best effort unless the host exposes authoritative pin-order
control.

The profile command resolves the target and reporting contract; the local CLI
cannot itself invoke the host task-message tool. Automatic host interception is
Unverified unless authoritative runtime metadata attests it, so caller delivery
remains required on runtimes without that interception.

Agent System owns triage through verified activation, but project continuation
does not depend on triage, repair, activation, or a reply. Runtime-only defects
remain findings; local tests do not prove hooks.

The persistent Agent System task is optional support, not a dependency.
Declining or removing it leaves JIT rule selection, scoped prompt composition,
delegation, native fallback, project-native tooling, and project completion
available. Only cross-task defect delivery disappears; the private local issue
disposition remains.

## Machine Profile Bootstrap

Use profile root commands only with direct authority; never hand-edit profiles
or infer authority. Ask for `ask`, `approve_for_me`, or `full`, then use
`profile approval --mode <choice> --authorize-profile-write`.

## Mutating Subagents

`fork_context` is not isolation. After routing `launch_mutating_subagent` and
loading `subagent-git`, prefer `seat assign`, `recover`, `continue`, and
`finalize`. A mutating `seat assign` returns an integrity-bound shell-free
`child_preflight`; pass it verbatim and require the child to run it exactly once.
It verifies assignment/worktree and owns implementation route, delivery, and
acknowledgment, so the child never constructs raw lifecycle JSON. Seat `0`
cannot receive a worker assignment. Apply the exact atomic exception above;
otherwise delegate. Mandatory delegation includes work over five minutes,
uncertain or multi-surface/risky work, browser/build/test/deploy/validation
execution, and explicit or established worker lanes. Never split or chain
micro-edits to evade this boundary; if time or scope crosses five minutes,
stop safely and delegate the remainder. Launch from the returned exact model,
reasoning, worktree, receipt,
and preflight. Use this lower-level sequence only when no intent command fits:

1. Prepare isolation before launch:
   `node ~/.codex/skills/govern-codex-policy/scripts/subagent-git.mjs prepare --repository <absolute-repository> --base <40-character-commit> --work-id <id> --seat <worker-seat> --worktree <absolute-new-worktree> --write-scope <relative-path> [--generated-scope <non-integrable-path>]...`
2. Require `prepared: true`; put its `receipt_path` and `worktree` in the prompt. Before first mutation, run:
   `node ~/.codex/skills/govern-codex-policy/scripts/subagent-git.mjs verify --receipt <absolute-receipt>`
3. Route with `route_request_field`; use the verified worktree as every command's `workdir`.
4. For later repair over expected owned changes, run `acg.mjs seat continue --project <slug> --receipt <assignment-receipt> --expected-head <40-character-commit> --intent implementation|validate`. `implementation` is the backward-compatible default; use `validate` when the immediate next operation is validation. Pass its returned shell-free `child_preflight` verbatim; the replacement runs it once and it owns receipt verification plus routing, delivery, and acknowledgment for that exact intent. Do not rerun clean preflight or construct raw route JSON. Canonical filesystem-equivalent receipt paths are accepted; receipt content/digest is the identity.

For an interrupted mutating seat, use `seat recover --assignment <package>`;
do not recreate source, base, scope, model, or reasoning arguments manually.
It derives them from the original assignment, copies only current regular files
inside the original write scope, and records neutral exclusions for untracked
out-of-scope files. A tracked out-of-scope dirty path fails recovery. `seat
finalize` records declared generated-output paths separately from integrable
write-scope paths and fails closed on an overlap or an undeclared path.

Stop only the affected delegated action on failure. Never share or improvise a
mutating worktree; helper failure grants no Seat `0` implementation,
commit, cleanup, or authority. Report or local-log the defect once and continue
other safe project work with existing tool definitions or native tools.

## Read-only Seats

Use `node ~/.codex/policies/bin/acg.mjs seat inspect --project <slug> --path <absolute-root> --seat <name> --model <id> --reasoning <value> [--attempt 1|2] [--objective <text>] [--prior-receipt <complete-prior-output.json>]`.

It owns classification, lifecycle, prior receipt, and returns a shell-free
`child_preflight` on a fresh ledger. Pass that object verbatim. The child runs
the returned `seat preflight --assignment ...` exactly once before inspection
and runs no other governance command. Replacement seats repeat this exact
preflight; zero-governance bypasses are inadmissible. Follow remediation once
and reuse only while assignment and release remain unchanged. Never give raw
lifecycle syntax, command `--help`, parent acknowledgment, or shell wrappers.

For an ungated native read-only fallback, `seat inspect` also returns an
integrity-bound `native_quarantine.spawn_request`. Pass that object verbatim;
never compose, summarize, or reformat its message. Wait for the exact completed
`READY_FOR_NATIVE_ATTESTATION` response, then attest. After acceptance, pass
`admitted_assignment.message` verbatim using a runtime input that starts a new
turn. Accept only the completion carrying its unique required final sentinel;
an untagged late quarantine completion is stale and inadmissible. Use
`--attempt 2` only for the one permitted replacement launch. If normal output
is truncated, recover only through the returned `--assignment` package: `seat
explain --assignment <package>` returns its exact integrity-validated
`admitted_assignment`; never reconstruct the message, guess a filename, or
rerun an already-consumed attempt.

Native attestation accepts a runtime UUID or an exact canonical collaboration
task path. Nicknames, partial paths, ordering, and output style are not identity
evidence. It remains post-launch evidence only: host activation, pre-launch
interception, chained-action enforcement, and actual reasoning identity remain
Unverified without authoritative runtime metadata.

If a host encrypts or otherwise withholds launch-message transcript content,
native envelope attestation fails closed. It grants no current-host admission,
and actual model/reasoning remain Unverified. Close only the quarantine seat and
continue the project through a permitted native fallback; do not report a host
activation or chained-action guarantee, and do not treat this as project
blocking.

## Model Routing Audit

Use `acg.mjs model-audit --thread <task-id> --days 14`; log only authoritative
bounded metadata, never prompts, source, output, secrets, or reasoning.

## Handoffs

1. Verify first with `node ~/.codex/policies/bin/acg.mjs handoff verify --project <slug> --handoff <absolute-path> [--pointer <absolute-path>] [--repository <absolute-path>]`.
2. Reconcile Git state, validation, blockers, open work, and next action.
3. Accept separately with `node ~/.codex/policies/bin/acg.mjs handoff accept --verification-receipt <verify-output.json>`. Add `--authorize-memory-write` only when the resolved continuity mode is `project_managed` and the user or project policy authorizes the write.
4. Use `handoff communicate` only for an actual message.

Verification is read-only. Acceptance writes at most one project-continuity
event; non-writing modes do not write. Global ad-hoc memory notes are supplementary, never canonical. Follow structured guidance once; do not build
raw route JSON or inspect router source.

## Audits

Use `node ~/.codex/policies/bin/acg.mjs audit --project <slug> --path <absolute-root> [--prior-receipt <complete-prior-output.json>]`.
It owns the lifecycle and returns verified `delivered_modules[].content` plus
`ACG_AUDIT_READY`. Pass the latest full acknowledgment. Stale release identity
requires a fresh context; never reset accounting.

## Manage Rules

Treat explicit "add/update/delete this rule in global agents" as a rule-management request. If destination is not explicit, ask whether it belongs globally, to a local organization, or to the active project before writing.

For each request:

1. Append `received` to `.runtime/rule-requests.jsonl`.
2. Resolve one owner: kernel, specialist module, private extension, or project file.
3. Normalize scope/evidence/failure behavior; check duplicates and conflicts.
4. Change one owner, preserve history, bump versions, regenerate, validate, and
   append outcome. Release only with authority; never patch live links.

## Request Ledger

The untracked JSONL ledger stores bounded request, scope, rationale, owner,
disposition, validation, commit, and release facts. Append corrections; exclude
secrets, reasoning, large output, and unrelated conversation.

## Fail Closed

Block only the affected operation on invalid policy identity/content,
dependencies, precedence, acknowledgment, immutable policy-artifact size
validation, or classification. This size validation never means advisory
closure or context estimates. Advisory context-growth targets never block an operation.

Receipts prove chain consistency, not runtime enforcement or model assignment. Report unavailable runtime evidence as `Unverified`.

### Receipt-pinned release resolution

With a prior acknowledgment, the CLI selects the immutable release matching its manifest, kernel, and skill. Supply the receipt once; do not guess a router, reload, or reset accounting. If no release matches, follow the fresh-context instruction.
Running tasks never reload or mix routers; new tasks use the active release. For a Codex desktop plugin install or update, app Reload is the supported refresh action; use a new top-level proof task only when launch-time enforcement must be proven. If Reload does not refresh the plugin, mark enforcement `Unverified`, continue projects through the permitted fallback, and leave any restart or diagnostic action to explicit operator choice. Neither Reload nor a fresh task retrofits transcript history or proves hook interception.

### Legacy task compatibility

Tasks do not automatically gain new launch hooks through reload. For a
runtime- or operator-confirmed pre-hook task, run:

`node ~/.codex/policies/bin/acg.mjs context adopt-current --operator-confirmed-pre-hook`

Read every returned bootstrap file completely in its declared order, state
that the load completed, and route the immediate operation with the current
high-level CLI without an old-release prior receipt. This adopts current policy,
skill, role, and helpers in the same task without changing existing authority.
Launch-time hook and host-interception enforcement remain Unverified; do not
claim otherwise. `context legacy` is a deprecated alias.

Continue same-task work and legacy agents by default. Warn once at adoption and
again only before a major feature whose safety or validity depends on missing
runtime enforcement. Require a fresh handoff only for that dependency, a
mutating model-critical launch that requires unavailable pre-launch
enforcement, an irreconcilable old/current contract conflict, or an
authoritative runtime capacity failure.

Do not use this path for a task expected to have current hooks. That case is a
bootstrap defect and remains fail-closed for the affected governed operation.

### Operator noise boundary

Keep routine governance internals silent unless they fail, materially change the assignment, or the operator asks. Normal shows task, owner, scope, status, meaningful change, and result; Warning shows a blocker, scope or authority conflict, unsafe dirty state, failed proof, or model mismatch; Diagnostic returns requested receipts, modules, routes, hashes, provenance, and accounting.

On material multi-phase work, update only at phase boundaries, material changes, blockers, validation milestones, completion, or required heartbeats. State phase, gate-derived percent (else `Unknown`), and ranged `Estimated` AI-active time with basis and confidence. Revise on critical-path evidence. Never give unadjusted human time, clock promises, or filler.

Keep the initial completion window beside current P50/P80 ETA. When its target
moves materially faster than elapsed time, state the gate, scope, failure,
validation, parallelism, or calibration evidence; otherwise retain it.
