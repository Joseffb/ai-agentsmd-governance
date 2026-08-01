# JIT Orchestration and Agent-Use Policy

Agent System's primary product is JIT Agent-file/rule discovery and the
smallest-sufficient scoped prompt composition. Agent-use enforcement is its
necessary execution control; dependency-aware scheduling is a thin launch-order
layer. It turns the immediate governed intent into the smallest verified rule
delta and smallest reliable worker topology. It governs agent use and prompt activation;
it does not govern project authority, product state, business decisions,
releases, deployment, publication, or execution ownership.

## Orchestration Bundle

For the immediate intent:

1. resolve the exact project, candidate, authority, effects, risks, and
   available runtime capabilities;
2. classify the action as `seat0_owned`, `seat0_atomic_allowed`,
   `worker_required`, or `project_authority_required`;
3. select only rules whose intent/effect predicates apply now;
4. preserve every previously entered policy digest and estimated cost in the
   monotonic context ledger, including prior versions;
5. from logical dependencies and integration contracts, choose `PARALLEL`,
   `PIPELINED`, `SERIAL`, or `EXPLORATORY`; a declaration of disjoint files or
   branches does not prove or imply `PARALLEL`;
6. select the lowest model family and raw reasoning level that reliably meets
   each seat's requirements;
7. compose a bounded worker prompt and, for mutation, bind it to verified
   isolation and authority; and
8. return a content-addressed bundle whose predecessor, classification, rule
   delta, ledger, topology, model request, and fallback data can be verified.

Future roadmap operations never affect current classification or rule
selection. A claimed short duration cannot override an effect, project
authority, worker ownership, or a stricter instruction.

Topology is JIT launch-order metadata, not broader context or persistent workflow state. Uncertain dependencies yield `SERIAL` or `EXPLORATORY`; a failed topology helper or classifier uses a bounded manual or native worker fallback under unchanged delegation boundaries and does not block the project.

Material decision evidence uses one append-only canonical event ledger.
Enriched `decision.material` records scope/type/action/normal path, authority
and references, evidence/rule references, a summary without prompt or hidden reasoning,
alternatives, risk/effect, actor, status/revision/basis/artifact, results, and
supersession. Legacy rows readable; common-envelope projection is
`event_family`, `event_type`, `project_id`, `authority_level`, and
`typed_payload`. Provenance/projection failures reduce coverage only.

## Deterministic-First Data Handling

Keep mechanical data mechanical. Use deterministic code for retrieval,
metadata, identity, calculations, validation, provenance, state, and
rendering. Use AI only for semantic interpretation, judgment, classification,
clustering, and synthesis. AI must never overwrite authoritative mechanical
data.

AI may consume an authoritative mechanical snapshot for semantic work, but its
derived output must remain distinguishable from that snapshot and cannot
replace or corrupt the authoritative mechanical data.

Composer-classified `mechanical` Spark work requires an integrity-bound gate
over its content-addressed request; inventory retrieval/collection, test execution,
validation, provenance, state, and rendering remain deterministic.

Launch exactly: `orchestrate next` ->
`orchestrate launch --bundle <path> --seat <N>` -> pass the returned
`native_quarantine.spawn_request` verbatim -> attest -> send the returned
`admitted_assignment.message` verbatim. Terra-low is supported only for
`unknown_or_unexposed` with `availability_evidence` equal to `Unverified`.
`authoritatively_unavailable` and `separate_pool_exhausted` are reserved; fail
closed absent a supported host receipt. Block only the affected launch; do not
move work to Seat `0` or block the project.

## Seat `0`

Seat `0` is the high-level orchestrator, not a worker. It owns classification,
decomposition, prompt composition, routing, coordination, synthesis, conflict
resolution, acceptance, evidence review, validation ownership, and final reporting.

Seat `0` can directly implement only one genuinely atomic correction meeting
these pre-mutation facts:

- explicitly atomic;
- low risk with a known remedy;
- delegation overhead dominates;
- estimated at no more than five AI-active minutes;
- exactly one source-mutation surface;
- not part of a worker-owned slice; and
- no contract, security, privacy, dependency, migration, build, test, browser,
  deployment, release, database, destructive, external, or other
  authority-changing effect.

Anything else is worker-required or project-authority-required. Exactly five
minutes is inside the exception; any more is outside it. Do not split, chain,
omit, or relabel effects to evade the boundary. Stop and delegate if the
estimate, elapsed time, surface count, remedy, risk, ownership, or effect
changes. A direct user or project instruction that “Seat 0 does not implement”
makes `seat0_atomic_allowed` unavailable.
This classification is advisory for Seat `0`; hooks may warn or record coverage
but always fail open. External platform, safety, user-authority, ownership,
data, destructive, and release constraints remain independently binding.

Seat `0` is excluded from the worker count. `N` agents or seats means `N`
delegated workers numbered `1` through `N`; topology labels still begin with
`0`. Say `total participants` when intentionally counting the orchestrator.
For substantial decomposable work, constrain this topology only for genuinely
tiny or tightly coupled work, unsafe overlap, unavailable capacity or tooling,
ordered dependencies, or coordination cost that truly erases benefit; state a
material constraint when useful capacity remains idle.

## Scoped Worker Prompts

Every worker prompt states role, immediate objective, project/repository, work
identifier, exact scope, candidate/isolation when relevant, references,
acceptance, stop, artifact, assumptions, validation, Git/effect permissions,
integration, evidence, and return. Shared-resource exclusions apply only to
non-file mutable state. Include only minimum context and policy delta; never
secrets, hidden reasoning, unrelated data, or authority the coordinator lacks.

Each mutating worker receives its own receipt-verified branch/worktree before
source inspection or mutation; it never merges, integrates, or touches the
shared primary worktree. Read-only workers cannot mutate source, Git,
continuity, generated tracked files, packages, caches, or external systems.
Read-only shared-checkout access and equivalent non-Git isolation exceptions
never weaken mutating Git isolation. Returned work is advisory until Seat `0`
alone owns integration of the accepted candidates, scope, and evidence;
project-authoritative validation runs against that integrated candidate.

Choose the lowest-capability model and raw reasoning that reliably handles the
assignment; record the request before launch. Actual model or reasoning needs
authoritative runtime metadata; narrative claims, style, role names, and output
quality are not evidence. Without attestation, report `Actual model: Unverified`.

## Native Recovery Ladder

An Agent System, helper, gateway, plugin, or launch failure blocks only the
affected path. Report or local-log the unchanged defect once according to the
active consent profile, preserve project state, and continue immediately
through any safe available option:

1. another supported high-level path;
2. direct native collaboration;
3. the same seat after conditions materially change or the failure is
   reasonably transient;
4. a replacement or rescoped worker;
5. a bounded manual worker prompt carrying the same scope, authority, model,
   reasoning, stop, evidence, and isolation contract; then
6. project-native tooling within existing authority.

This ordered set is not a requirement to attempt unavailable or unsuitable
paths. There is no fixed retry count, but an unchanged relaunch loop is
prohibited. Retries or replacements cannot admit stale or unverified output.
No fallback grants Seat `0` substantial implementation, missing project
authority, destructive authority, or release authority.

Ask only when the remaining safe path needs new authority, a destructive or
materially ambiguous decision, or an absent required resource. Otherwise
continue. There is no wait-for-Agent-System state: Agent System failure never
blocks the project, and a later repair reply is not project-resume permission.

## Agent System Defect Consent

A fresh installation separately asks about a persistent Agent System task,
bounded governance/runtime defect reporting, and true-blocker repair; task
operation, reporting, and repair can consume tokens. Each needs active consent;
automatic reporting also needs an active task lane.

Enabled reporting requires `log_only` or `auto_correct`; missing, disabled,
undecided, inactive, or local-only repair consent means no repair. Legacy or
unqualified reporting maps to `log_only`, never authorizing automatic KPI or
after-action reports, repair, project mutation, or public-branch mutation.
`log_only` records every eligible Agent System/runtime issue and never starts
repair. Opted-in `auto_correct` automatically repairs only a confirmed, locally
actionable true Agent System blocker and logs every other issue without repair.
A true blocker is an Observed/Verified P0/P1 defect disabling a required core
Agent System capability, locally actionable within private Agent System scope,
with no equivalent supported repair path. It is not a project defect, caller syntax error,
external runtime-only limitation, destructive/irreversible change,
architecture/public-contract redesign, source-project mutation, public publication, or schedule.

Absent, undecided, inactive, declined, or local-only reporting consent permits
only a quiet bounded secret-free private untracked JSONL append: not a message,
never creating or waking a task, and no background reporting tokens. Active
delivery resolves one current non-archived exact-label target, sends unchanged
evidence once, and immediately continues the project. Do not claim background
interception without authoritative runtime evidence.

## Incident Filter and Aggregation

Append every bounded governance/runtime incident to the private JSONL ledger
first; classify it as `agent_system`, `worker_adherence`, `host_runtime`,
`project_tool_side_effect`, `caller_error`, or `expected_fail_closed`. Ordinary
project defects, caller mistakes, expected fail-closed results, and worker
adherence are not Agent System defects; another category crosses only after
separate confirmed append-only reclassification to `agent_system`.

Cross-task delivery is only for a new confirmed `agent_system` failure class,
materially new repair-advancing evidence, or a true Observed/Verified P0/P1
core blocker with no supported fallback. Aggregate repeats/addenda by failure
class; append corrections, including reclassifications. The reporting project
continues through fallback after local append or permitted delivery.

The local append returns delivery eligibility. Active reporting sends at most
one eligible cross-task message; disabled stays local-only. Delivery-unavailable
entries require explicit category and stable failure class, stay local, and
never resend. A confirmed append-only reclassification to `agent_system` may
report once when eligible, but correction alone never authorizes `auto_correct`.

The persistent task is an optional support lane, never a JIT dependency.
Removing or declining it leaves rule selection, prompt composition,
delegation, native recovery, project-native tooling, and project completion
available. Only cross-task defect delivery disappears; the private local issue
disposition remains.

## KPI Boundary

```text
Kernel -> Receipts -> Events -> Metrics
```

KPI lifecycle facts are silent private JSONL writes. Metrics observe execution
and never become execution authority; they consume evidence. No KPI, alone or
in combination, may automatically route, rank, reward, punish, block,
authorize, select models, choose delegation, set worker count, declare
progress/completion, or mutate policy. Historical metric data remain
downstream-only and cannot feed live prompts or decisions automatically.

Accepted validated scope and engineered output are the primary reporting
numerator. Acceptance status, artifacts, validation, actor/time,
revision/rework, first output, validation completion, and operator touch/wait
remain independently visible when evidenced. Tokens and cost are downstream
denominators only. OECB headline evidence is explicitly
Observed/Derived/Proposed/Unknown, missing effort remains `null`, and no report
becomes execution authority.

Worker topology follows real, independently integrable architecture boundaries;
agent count is never a target. Metric-informed policy changes need explicit
operator review, a new version, stated assumptions, and post-change
recalibration. Missing timings, estimates, intervals, validation, acceptance,
or model attestation remain `null` with coverage; never infer them.

Ashby's Law of Requisite Variety constrains governance complexity: it must not
exceed what operators can understand or workers can reliably execute. Add rules
only for observed failure classes; every rule needs a clear purpose and
observable effect. Expose unresolved rule conflicts rather than silently
choosing, and ensure governance reduces uncertainty rather than creating it.

KPI and after-action reports are produced only in response to a direct operator
request. Cleanup, completion, defect reporting, task replacement, and automatic
reporting consent never generate one. Reports are bounded, private, read-only,
identity-minimized, and cannot reopen completion, transfer ownership, create a
wait state, or become policy input.
