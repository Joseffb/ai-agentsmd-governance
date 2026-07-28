# Delegation Policy

For substantial work, use maximum useful concurrency when bounded independent seats can safely shorten the critical path or add valuable independent challenge. Fill available worker capacity with separable research, implementation, tests, and review; keep ordered dependencies and shared-contract decisions serial. Do not delegate tiny or tightly coupled work, ceremony, duplicate discovery, overlapping writes, or work whose context transfer, coordination, synthesis, and validation cost erases the benefit. If safe beneficial parallel work is left idle, state the concrete constraint.

Mutating `seat assign` emits an integrity-bound shell-free child preflight. Pass it verbatim; it verifies the assignment/worktree and owns the immediate implementation route, delivery, and acknowledgment. A child never constructs raw lifecycle JSON.

Seat `0` is the responsive, user-facing orchestrator and cannot receive a worker assignment: it owns routing, synthesis, conflicts, evidence, validation, release, and reporting. It may directly implement one genuinely atomic, bounded correction only when estimated before start at no more than five AI-active minutes and delegation overhead dominates.

Delegate when work exceeds five minutes, scope is uncertain, surfaces or risk are multiple, or it requires browser, build, test, deploy, or validation execution, or when a worker lane is explicit or already established. Do not split or chain micro-edits to evade this rule. If elapsed time or scope crosses five minutes, stop at a safe boundary and delegate what remains.

A stricter direct user or project instruction, including “Seat 0 does not implement,” overrides this exception. Apply the boundary by effect, not labels (integration, validation, recovery, audit, generated, temporary, cache, artifact, urgency, repair); equivalent actions and omissions cannot bypass it. Receipts are procedural, not host-interception proof.

A missing, failed, or incompatible helper never grants Seat `0` implementation
authority. Preserve the same delegation boundary, report or local-log the
helper defect once according to consent, and continue other safe project work
with existing tool definitions or native tools.

Use one counting contract in capacity reports, dashboards, and operator updates. Reserve seat `0` for the coordinator/orchestrator so topology labels start at zero, but exclude it from the unqualified agent count and seat count. A displayed count of `N` means `N` delegated worker seats, numbered `1` through `N`; the topology therefore has labels `0` through `N`. For example, a count of `2` may be reported as `0 orchestrator, 1 UI, 2 security`. Use `total participants` when a value intentionally includes the orchestrator.

Apply `model-routing` to every seat: choose the lowest capable family and reasoning tier that can reliably complete and validate it. Never silently downgrade an exact or reasoning-critical assignment. Ask once only when the coordinator is below the task's demonstrated requirement; an unanswered request does not block safe work.

Each seat owns a fresh governance ledger. Never pass a parent policy acknowledgment as a child's `prior_receipt`. If releases may differ, use bounded non-forked context; the child routes without a prior receipt. Keep ledgers separate. Mutating seats receive only their verified worktree receipt.

Reuse an active seat only when its objective, project, repository state, model and reasoning assignment, authority, and context remain valid. Do not reuse when independent or adversarial review is needed; model, reasoning, authority, project, worktree, or write ownership changes; or context may be stale. After reconciliation, promptly close completed, failed, redundant, or idle seats so they release shared runtime concurrency. Keep a completed seat open only for an immediate, tightly related reuse. Treat any exact agent limit as runtime metadata, not a hard-coded constant.

Every significant prompt includes role, objective, project and repository, work ID, branch/worktree and base commit when relevant, bounded continuity, authoritative references, allowed read/write scope, acceptance criteria, stop conditions, validation, Git permissions, integration dependencies, and return format.

Load `model-routing` before launch. Also load `subagent-git` and `continuity` before mutating launch. Read-only seats must not mutate source, Git, tracked generated files, locks, formatter output, or continuity.

Use route mode `delegation` for subagent planning and read-only launch. Keep `mutation_authority:false` for read-only seats and grant only `delegation`. Mutating seats use mutation mode and the isolated-worktree contract.

Returned work is advisory until the coordinator verifies claimed files, candidate commit, diff scope, and validation evidence. Centralize conflicts and shared-contract decisions. Stop or redirect satisfied, superseded, or redundant seats; report why beneficial delegation was safely skipped.

## Coordination Recovery

Use only exact host IDs returned by thread tools or delegation metadata; never substitute `local`. If `wait_threads` has no handler, do not infer failure or loop: use one `read_thread` snapshot when available, otherwise continue independent work and report the runtime defect.

For any authorized task-to-task exchange, the receiving task replies directly when it has a result, blocker, question, decision, payload, or follow-up task for the sender. Send a brief receipt only when useful for long work, then return the outcome when known. Purely informational messages requiring no action need no reply. Never create acknowledgment loops.

Agent System defect delivery is not implied by delegation. A fresh installation
must separately obtain explicit consent to maintain a persistent Agent System
task and to automatically report governance/runtime defects to it; both task
operation and reporting can consume tokens. Task maintenance requires its own
active consent; automatic defect reporting requires its own active consent, an
active task lane, and a `log_only` or `auto_correct` disposition. The
compatibility profile maps enabled legacy or unqualified automatic reporting to
`log_only`; it never enables automatic KPI or after-action reports or automatic
repair. `log_only` records or delivers one bounded defect and never starts
repair. Without the consent required for a capability, do not perform it or
spend background tokens. In inactive or local-only reporting mode, use only a
quiet bounded secret-free append to the private untracked local JSONL issue
ledger. In configured reporting mode, preserve exact current-label lookup,
duplicate resolution, explicitly enabled auto-creation, and immediate project
continuation. `auto_correct` is limited to private Agent System surfaces and
cannot mutate the reporting project or any public branch. Host interception
remains Unverified without authoritative runtime metadata.

Do not add delegation-specific confirmation gates. Apply the kernel's configured `approval_mode`; pause only the affected action.

When the user authorizes cross-task governance repair, the receiving task owns triage, repair, validation, activation, and direct notification to the reporter. The reporting task does not wait for that lifecycle: after one report or local log it immediately continues with existing tool definitions or native tools within current authority. Agent System may reject an improper Seat `0` action, but it never blocks the project. After verified activation, send reload or changed-path guidance only when useful; it is not project-resume permission.
## Intent-oriented seat operations

Prefer `acg.mjs seat inspect` for read-only seats and `seat assign`, `seat recover`, `seat continue`, and `seat finalize` for mutating seats. `seat inspect` owns catalog values, prior-receipt normalization, route/delivery/acknowledgment, a fresh child ledger, one corrected retry, exact reuse rules, one shell-free `seat preflight --assignment ...` command, and the exact native quarantine spawn request when the host path is ungated. Pass that returned `child_preflight` verbatim. Pass `native_quarantine.spawn_request` verbatim at its documented lifecycle point too; never construct either object's protocol fields manually. After native admission, the child runs it exactly once before source inspection and runs no other governance command. A replacement seat must also run its own returned preflight; skipping governance entirely is not a valid workaround. Never make the child discover raw lifecycle syntax, unsupported command-specific `--help`, or shell wrappers.

The mutating commands bind current coordinator authority, repository/base identity, exact write scope, separately declared `--generated-scope` paths, model request, isolated worktree, and provenance. Generated scopes must not overlap write scope or contain tracked files at preparation. They may hold authorized build/install output, but are non-integrable and are excluded from continuation dirty payloads and digests without enumerating their trees. Undeclared output remains fail-closed. A prior policy receipt carries context accounting only; it cannot grant a new seat mutation authority. A child starts its own ledger.

Recovery copies only explicitly scoped regular files into a clean-base worktree and records source, destination, and final digests. Project-specific validation remains in the project overlay or assignment.

Use the governance skill's operator-noise and progress contract. Routine machinery stays silent unless it fails or materially changes the assignment.
