# Delegation Policy

## Dependency-aware launch topology

**Default parallel delivery lifecycle:** decompose before launch -> reserve the
largest useful set of non-overlapping independent lanes within available capacity -> isolated
branch/worktree per mutating worker -> worker implementation and local tests
-> Seat `0` integration -> authoritative final validation on the integrated
candidate**. Reserve the largest useful independent set within available
capacity; keep only ordered dependencies and shared-contract decisions serial.
Run separable implementation, test, and review lanes concurrently when their
logical dependencies and integration contracts permit it.

Choose launch order from logical dependencies and integration contracts, not
file or branch disjointness alone. A declaration of disjoint files or branches
does not prove or imply `PARALLEL`: isolated branches prevent Git collisions, not logical
dependencies. Use only these topology classes:

- `PARALLEL`: workers can independently implement, test, and commit; Seat `0`
  may integrate accepted candidates in any order.
- `PIPELINED`: separate workers proceed in dependency order because a downstream
  worker consumes an upstream artifact or commit.
- `SERIAL`: one worker owns the coherent implementation chain.
- `EXPLORATORY`: one bounded investigation discovers the implementation
  decomposition before implementation lanes launch.

For substantial decomposable work, choose the smallest topology that preserves
the real dependency order. Before launching each mutating worker, create and verify one isolated branch/worktree
for that worker. Workers implement, run their assigned
local tests, and return an integrable candidate; they never merge, integrate,
or touch the shared primary worktree. Seat `0` alone owns integration; Seat `0` accepts and integrates candidate work, then runs
authoritative validation against that integrated candidate. A truly read-only worker needs no new worktree. For non-Git
mutation, establish equivalent isolated mutable state; do not pretend a Git
worktree boundary applies. Read-only shared-checkout access and equivalent
non-Git isolation exceptions never weaken mutating Git isolation.

Topology is JIT launch-order metadata: it does not load broader context or
create a persistent workflow state machine. When dependency confidence is
insufficient, choose `SERIAL` or `EXPLORATORY`. If a topology helper or
classifier fails, preserve delegation boundaries and use a bounded manual or
native worker fallback; the project continues under existing authority.

### Shared-invariant defect clusters

Classify by shared root cause, invariant, or ownership boundary, not path;
same-file/overlapping-ownership signals. Such a cluster is
`SERIAL` with exactly one mutating worker, never split across parallel mutation.
Only after that sole worker commits its locally validated candidate, run a
separate `PIPELINED` read-only adversarial verifier for invariant, boundary,
and regressions. It cannot change source, Git, tracked/generated files, or the
candidate; its output informs Seat `0` acceptance/final validation, not
implementation. `PARALLEL` only applies to distinct clusters independently
implementable, testable, committable, and integrable in any order; otherwise
use `SERIAL` or `EXPLORATORY`. This is JIT launch-order guidance, not a
scheduler state machine or new subsystem.

Skip or constrain this default only for genuinely tiny or tightly coupled work,
unsafe overlap, unavailable capacity or tooling, ordered dependencies, or when
coordination cost truly erases the benefit. Do not use ceremony, a convenient
single-worker topology, or an untested assertion of coupling as a substitute
for decomposition. When useful capacity remains idle, state the material
constraint.

Mutating `seat assign` emits an integrity-bound shell-free child preflight. Pass it verbatim; it verifies the assignment/worktree and owns the immediate implementation route, delivery, and acknowledgment. A child never constructs raw lifecycle JSON.

Seat `0` is the responsive, user-facing orchestrator and cannot receive a worker assignment: it owns routing, synthesis, conflicts, acceptance and integration, evidence, authoritative validation, release, and reporting. It may directly implement one genuinely atomic, bounded correction only when estimated before start at no more than five AI-active minutes and delegation overhead dominates; it must not absorb a substantial implementation lane.

Delegate when work exceeds five minutes, scope is uncertain, surfaces or risk are multiple, or it requires browser, build, test, deploy, or validation execution, or when a worker lane is explicit or already established. Do not split or chain micro-edits to evade this rule. If elapsed time or scope crosses five minutes, stop at a safe boundary and delegate what remains.

A stricter direct user or project instruction, including “Seat 0 does not implement,” overrides this exception. Apply the boundary by effect, not labels (integration, validation, recovery, audit, generated, temporary, cache, artifact, urgency, repair); equivalent actions and omissions cannot bypass it. Receipts are procedural, not host-interception proof.

A missing, failed, or incompatible helper never grants Seat `0` implementation
authority or blocks the project. Preserve the same delegation boundary, report
or local-log the helper defect once according to consent, then continue with a
safe native/manual worker path or project-owned tooling under existing
authority.

In capacity reports, seat `0` is the coordinator and excluded from unqualified
agent/seat counts. `N` means workers `1..N` (topology `0..N`); use `total
participants` only when including the coordinator.

Apply `model-routing` to every seat: choose the lowest capable family and reasoning tier that can reliably complete and validate it. Never silently downgrade an exact or reasoning-critical assignment. Ask once only when the coordinator is below the task's demonstrated requirement; an unanswered request does not block safe work.

Each seat owns a fresh governance ledger. Never pass a parent policy acknowledgment as a child's `prior_receipt`. If releases may differ, use bounded non-forked context; the child routes without a prior receipt. Keep ledgers separate. Mutating seats receive only their verified worktree receipt.

Reuse a seat only while objective, project, repository state, model/reasoning,
authority, and context remain valid. Do not reuse it for independent/adversarial
review or changed model, authority, project, worktree, or write ownership.
Promptly close completed, failed, redundant, or idle seats; exact agent limits
are runtime metadata, not hard-coded constants.

Every significant prompt states role, objective, project/repository/work ID,
relevant worktree/base, bounded continuity/references, allowed scope,
acceptance/stop/artifact, assumptions, validation, Git, integration, evidence,
and return. Name shared non-file mutable resources only when needed.

Load `model-routing` before launch. Also load `subagent-git` and `continuity` before mutating launch. Read-only seats must not mutate source, Git, tracked generated files, locks, formatter output, or continuity.

Use route mode `delegation` for subagent planning and read-only launch. Keep `mutation_authority:false` for read-only seats and grant only `delegation`. Mutating seats use mutation mode and the isolated-worktree contract.

Returned work is advisory until the coordinator verifies claimed files, candidate commit, diff scope, and validation evidence. Seat `0` alone integrates accepted candidates; authoritative validation runs only after integration against the integrated candidate. Centralize conflicts and shared-contract decisions. Stop or redirect satisfied, superseded, or redundant seats; report why beneficial delegation was safely skipped.

## Coordination Recovery

Use only exact host IDs returned by thread tools or delegation metadata; never substitute `local`. If `wait_threads` has no handler, do not infer failure or loop: use one `read_thread` snapshot when available, otherwise continue independent work and report the runtime defect.

For any authorized task-to-task exchange, the receiving task replies directly when it has a result, blocker, question, decision, payload, or follow-up task for the sender. Send a brief receipt only when useful for long work, then return the outcome when known. Purely informational messages requiring no action need no reply. Never create acknowledgment loops.

Agent System defect delivery is not implied by delegation. A fresh installation
must separately obtain explicit consent to maintain a persistent Agent System
task, automatically report governance/runtime defects to it, and repair true
Agent System blockers; task operation, reporting, and repair can consume
tokens. Each capability requires its own active consent; automatic reporting
also requires an active task lane and a `log_only` or `auto_correct`
disposition. The compatibility profile maps enabled legacy or unqualified
automatic reporting to `log_only`; it never enables automatic KPI or
after-action reports or automatic repair. Missing, disabled, undecided,
inactive, or local-only repair consent means no repair. `log_only` records
every eligible Agent System/runtime issue and never starts repair. Opted-in
`auto_correct` automatically repairs only a confirmed, locally actionable true
Agent System blocker and logs every other issue without repair. A true blocker
is an Observed/Verified P0/P1 defect that disables a required core Agent System
capability, is locally actionable within private Agent System scope, has no
equivalent supported repair path restoring that capability, and is not a
project defect, caller syntax error, external runtime-only limitation,
destructive/irreversible change, architecture/public-contract redesign,
source-project mutation, public publication, or schedule. Without the consent
required for a capability, do not perform it or spend background tokens. In inactive or local-only reporting mode, use only a
quiet bounded secret-free append to the private untracked local JSONL issue
ledger. In configured reporting mode, preserve exact current-label lookup,
duplicate resolution, explicitly enabled auto-creation, and immediate project
continuation. `auto_correct` is limited to private Agent System surfaces and
cannot mutate the reporting project or any public branch. The source project
never waits and continues through fallback. Host interception remains
Unverified without authoritative runtime metadata.

Every bounded governance/runtime incident is first privately appended to JSONL
as `agent_system`, `worker_adherence`, `host_runtime`,
`project_tool_side_effect`, `caller_error`, or `expected_fail_closed`. Deliver
across tasks only for a new confirmed `agent_system` failure class, materially
new repair-advancing evidence, or a true no-fallback P0/P1 core blocker;
aggregate repeats by class and append corrections, including reclassification.
The remaining categories are not Agent System defects unless separately
confirmed as `agent_system`.

Do not add delegation-specific confirmation gates. Apply the kernel's configured `approval_mode`; pause only the affected action.

With authorized cross-task governance repair, the receiver owns triage, repair,
validation, activation, and direct reporter notification. The reporting task
reports/local-logs once and immediately continues through existing tools or native
tools within current authority; Agent System may reject an improper Seat `0`
action but never blocks the project. After verified tracked edits release+activate,
notify each known active project task once by current exact label to reload/adopt
before its next governed operation. This is not project-resume permission, never
forces handoff/compaction, claims retrofitted hooks, or stores thread IDs; app
Reload is only for plugin/hook host refresh.
## Intent-oriented seat operations

Prefer `acg.mjs seat inspect` for read-only seats and `seat assign`, `seat recover`, `seat continue`, and `seat finalize` for mutating seats. `seat inspect` owns catalog values, prior-receipt normalization, route/delivery/acknowledgment, a fresh child ledger, one corrected retry, exact reuse rules, one shell-free `seat preflight --assignment ...` command, and the exact native quarantine spawn request when the host path is ungated. Pass that returned `child_preflight` verbatim. Pass `native_quarantine.spawn_request` verbatim at its documented lifecycle point too; never construct either object's protocol fields manually. After native admission, the child runs it exactly once before source inspection and runs no other governance command. A replacement seat must also run its own returned preflight; skipping governance entirely is not a valid workaround. Never make the child discover raw lifecycle syntax, unsupported command-specific `--help`, or shell wrappers.

The mutating commands bind current coordinator authority, repository/base identity, exact write scope, separately declared `--generated-scope` paths, model request, isolated worktree, and provenance. Generated scopes must not overlap write scope or contain tracked files at preparation. They may hold authorized build/install output, but are non-integrable and are excluded from continuation dirty payloads and digests without enumerating their trees. Undeclared output remains fail-closed. A prior policy receipt carries context accounting only; it cannot grant a new seat mutation authority. A child starts its own ledger.

Recovery copies only explicitly scoped regular files into a clean-base worktree and records source, destination, and final digests. Project-specific validation remains in the project overlay or assignment.

Use the governance skill's operator-noise and progress contract. Routine machinery stays silent unless it fails or materially changes the assignment.
