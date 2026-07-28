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
5. choose `PARALLEL`, `PIPELINED`, `SERIAL`, or `EXPLORATORY` from logical
   dependencies and integration contracts, not file disjointness alone;
6. select the lowest model family and raw reasoning level that reliably meets
   each seat's requirements;
7. compose a bounded worker prompt and, for mutation, bind it to verified
   isolation and authority; and
8. return a content-addressed bundle whose predecessor, classification, rule
   delta, ledger, topology, model request, and fallback data can be verified.

Future roadmap operations never affect current classification or rule
selection. A claimed short duration cannot override an effect, project
authority, worker ownership, or a stricter instruction.

Topology is JIT launch-order metadata, not broader context or persistent workflow state. Uncertain dependencies yield `SERIAL` or `EXPLORATORY`; if a topology helper or classifier fails, use a bounded manual or native worker fallback under unchanged delegation boundaries and do not block the project.
Topology helper or classifier failure does not block the project.

## Deterministic-First Data Handling

Keep mechanical data mechanical. Use deterministic code for retrieval,
metadata, identity, calculations, validation, provenance, state, and
rendering. Use AI only for semantic interpretation, judgment, classification,
clustering, and synthesis. AI must never overwrite authoritative mechanical
data.

AI may consume an authoritative mechanical snapshot for semantic work, but
its derived output must remain distinguishable from that snapshot and cannot
replace or corrupt the authoritative mechanical data. This reduces token cost,
latency, and hallucination risk across projects.

## Seat `0`

Seat `0` is the high-level orchestrator, not a worker. It owns classification,
decomposition, prompt composition, routing, coordination, synthesis, conflict
resolution, acceptance, evidence review, validation ownership, and final
reporting. Non-implementation coordination has no mutation effect.

Seat `0` can directly implement only one genuinely atomic correction meeting
all of these pre-mutation facts:

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
minutes is inside the exception; five minutes plus any amount is outside it.
Do not split, chain, omit, or relabel effects to evade the boundary. Stop and
delegate the remainder if the estimate, elapsed time, surface count, remedy,
risk, ownership, or effect changes. A direct user or project instruction that
“Seat 0 does not implement” makes `seat0_atomic_allowed` unavailable.

Seat `0` is excluded from the worker count. `N` agents or seats means `N`
delegated workers numbered `1` through `N`; topology labels still begin with
`0`. Say `total participants` when intentionally counting the orchestrator.
For substantial decomposable work, constrain this topology only for genuinely
tiny or tightly coupled work, unsafe overlap, unavailable capacity or tooling,
ordered dependencies, or coordination cost that truly erases benefit; state a
material constraint when useful capacity remains idle.

## Scoped Worker Prompts

Every worker prompt states the role, immediate objective, project and
repository, work identifier, exact read/write scope, candidate and isolation
when relevant, required references, acceptance criteria, stop conditions,
expected artifact, upstream assumptions, validation responsibility, Git/effect
permissions, integration order, evidence, and return format. Include shared-
resource exclusions only for non-file mutable state such as schemas, migrations,
lockfiles, ports, databases, generated registries, or mutable fixtures. Include
only the minimum project context and policy delta
needed for that seat. Never include secrets, hidden reasoning, unrelated
project data, or authority the coordinator does not hold.

Each mutating worker receives its own receipt-verified branch/worktree before
source inspection or mutation; it never merges, integrates, or touches the
shared primary worktree. Read-only workers cannot mutate source, Git,
continuity, generated tracked files, packages, caches, or external systems.
Returned work is advisory until Seat `0` reconciles and integrates the accepted
candidates, scope, and evidence; project-authoritative validation runs against
that integrated candidate.

Choose the lowest-capability model and raw reasoning level that reliably
handles the assigned reasoning and validation. Record the request before
launch. Actual model or reasoning requires authoritative runtime metadata;
narrative claims, style, role names, and output quality are not evidence.
Report `Actual model: Unverified` when attestation is absent.

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

This is an ordered set of available recovery options, not a requirement to
attempt unavailable or unsuitable paths. There is no fixed retry count, but an
unchanged relaunch loop is prohibited. A retry or replacement must not admit
stale or unverified output. No fallback grants Seat `0` substantial
implementation, missing project authority, destructive authority, or release
authority.

Ask the operator only when the remaining safe path needs new authority, a
destructive or materially ambiguous decision, or a required resource that is
actually absent. Otherwise continue. There is no wait-for-Agent-System state:
Agent System failure never blocks the project, and a later repair reply is not
project-resume permission.

## Agent System Defect Consent

A fresh installation asks two separate questions: whether to create and
maintain a persistent Agent System task, and whether to automatically send it
bounded governance/runtime defect reports. State that both capabilities can
consume tokens. Task maintenance requires its own active consent; automatic
reporting requires its own active consent and active task lane.

Enabled defect reporting requires `log_only` or `auto_correct`. Legacy or
unqualified reporting consent maps to `log_only`; it never authorizes
automatic KPI or after-action reports, automatic repair, project mutation, or
public-branch mutation. `log_only` records or delivers one bounded defect and
never starts repair. `auto_correct` is restricted to private Agent System code,
configuration, isolated worktrees, and private release lanes under separately
established authority.

Absent, undecided, inactive, declined, or local-only reporting consent permits
only a quiet bounded secret-free append to the private untracked local JSONL
issue ledger. It is not a message, never creates or wakes a task, and spends no
background reporting tokens. Active delivery resolves one current
non-archived exact-label target, sends unchanged evidence once, and continues
the project immediately. Do not claim background interception without
authoritative runtime evidence.

The persistent task is an optional support lane, never a JIT dependency.
Removing or declining it leaves rule selection, prompt composition,
delegation, native recovery, project-native tooling, and project completion
available. Only cross-task defect delivery disappears; the private local issue
disposition remains.

## KPI Boundary

The analytics flow is one-way:

```text
Kernel -> Receipts -> Events -> Metrics
```

KPI lifecycle facts are silent private JSONL writes. Metrics observe execution
and never become execution authority; they consume evidence. No KPI, alone or
in combination, may automatically route, rank, reward, punish, block,
authorize, select models, choose delegation, set worker count, declare
progress or completion, or mutate policy. Historical metric data remain
downstream-only and cannot feed live prompts or decisions automatically.

Worker topology follows real, independently integrable architecture boundaries;
agent count is never a target. Metric-informed policy changes require explicit
operator review, a new version, stated assumptions, and post-change
recalibration. Missing timings, estimates, intervals, validation, acceptance,
or model attestation remain `null` with coverage; never infer them.

Ashby's Law of Requisite Variety constrains governance complexity: it must not
exceed what operators can understand or workers can reliably execute. Add rules
only for observed failure classes; every rule needs a clear purpose and
observable effect. Expose unresolved rule conflicts rather than silently
choosing, and ensure governance reduces uncertainty rather than creating it.

KPI and after-action reports are produced only in response to a direct
operator request. Cleanup, completion, defect reporting, task replacement, and
automatic reporting consent never generate or send one. Reports are bounded,
private, read-only, and identity-minimized; they cannot reopen completion,
transfer project ownership, create a wait state, or become policy input.
