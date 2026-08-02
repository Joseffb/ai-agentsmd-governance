# Model Routing Policy

Choose the lowest-capability family and lowest reasoning level that can reliably complete and validate the seat. Escalate only for a documented risk or failure mode. Consider complexity, novelty, ambiguity, blast radius, contract sensitivity, security, debugging difficulty, and reasoning-failure cost.

Use standard mode. Never enable, request, or recommend Fast mode for the coordinator or any delegated seat. This does not restrict explicit model-family or reasoning selection.

Bias against `ultra` reasoning. First re-prompt or clarify, narrow or decompose, gather better evidence, and use independent `xhigh` evaluation. Consider `ultra` only if those steps cannot resolve a material blocker. For each use, explain why `xhigh` is insufficient, why the expected correctness benefit outweighs the added token, compute, and cost footprint, and obtain explicit user agreement for that exact incident. Silence, standing authority, or prior agreement does not carry forward.

Families, in capability-and-safety-first order (then wall-clock, then tokens
and cost):

- Luna Max: preferred lowest-cost bounded routine implementer for clear
  implementation, focused tests, fixtures, documentation, formatting, and
  repeatable engineering work; request `gpt-5.6-luna` with `max` reasoning.
  Do not use Luna merely because it is cheap for security-critical, authority,
  migration, destructive, privacy, release, deployment, or high-ambiguity
  work.
- Terra Max: complex implementation, debugging, migration, integration, and
  multi-file work; request `gpt-5.6-terra` with `max` reasoning. The narrow
  Spark availability fallback remains the separately governed Terra `low`
  exception below.
- GPT-5.3-Codex-Spark: mandatory only for composer-derived `mechanical` bounded delegated AI transformation or mechanical-edit work when explicitly selectable from its separate pool. Use the exact runtime ID `gpt-5.3-codex-spark` with `low` reasoning.
- Sol High: adversarial work, architecture, authority review, distributed
  systems, difficult concurrency, security-critical design, conflict
  resolution, and final high-risk verdicts; request `gpt-5.6-sol` with `high`
  reasoning. Minimize use without lowering quality.

## Subagent Assignment

### Luna Native and Installed-CLI Worker Path

An observed native collaboration override can exclude Luna even when the
installed Codex CLI authoritatively supports the Luna runtime ID. Prefer
native collaboration or the configured custom `luna_worker` whenever that
selection is exposed. This is proactive eligible routing, not a failure-only
fallback: when the collaboration override excludes Luna but the installed CLI
authoritatively supports it, Seat 0 may launch one bounded manual Luna worker.
This CLI path is a bounded manual-worker adapter, not a native-collaboration
subagent and not an equivalent source of lifecycle, steering, or attestation
evidence.

Before that launch, preserve the ordinary worker contract: capability and
safety fit first, participant and capacity limits, one exact isolated worktree
for mutation, bounded scope and acceptance criteria, proportionate validation,
and a defined lifecycle/evidence return. Reserve one available worker slot
before launch and record its owner, exact isolated worktree/cwd, process or
session identity, and expected return. Do not use a user-owned `create_thread`
as a subagent substitute.

The coordinator creates one self-contained, secret-free prompt file with the
entire assignment, isolation, acceptance, validation, and return contract.
Launch exactly once as a non-TTY process; it has no interactive steering,
follow-up turns, or resume path. For mutation, a portable shell-safe invocation
is:

```sh
codex exec --cd "$worker_worktree" --model gpt-5.6-luna -c 'model_reasoning_effort="max"' --sandbox workspace-write --json - < "$prompt_file"
```

`$worker_worktree` is the pre-verified exact isolated worktree and
`$prompt_file` is the coordinator-owned self-contained prompt file; neither
shell variable is a machine path or a place to embed secrets. For read-only
work, replace `--sandbox workspace-write` with the read-only sandbox. Keep the
JSON lifecycle/evidence output private and ingest only bounded lifecycle and
evidence facts into the normal coordination record.

The recorded lifecycle owner owns the CLI PID or session, observes verified
exit or interruption, and performs bounded cancellation and process/session
cleanup when needed. Release the reserved worker slot only after that verified
exit or interruption and the bounded cleanup outcome are recorded. Never
delete, reset, or otherwise disturb the isolated candidate/worktree during
cancellation or cleanup. If process ownership or exit is unverified, preserve
candidate state, retain the reservation, and escalate or use another safe
worker path; do not relaunch or imply a completed cleanup.

The command records requested configuration only. CLI JSON, a PID, a session,
or a worker report is not a public claim or model attestation: requested model
and reasoning remain configuration, and actual model and reasoning remain
`Unverified` unless authoritative runtime metadata attests them.

### Spark-Eligible Bounded Delegated Work

Spark eligibility is composer-derived, not inferred from task labels, prose,
or a manually selected cheap model. Only the exact `mechanical` complexity
class may produce the `gpt-5.3-codex-spark` and `low` recommendation. The
composer propagates that request through its content-addressed bundle, worker
request, and prompt envelope. On a hook-covered path, the integrity-bound Model
Routing Gate must verify that composer-derived request before launch.

Spark-eligible scope is limited to a bounded delegated AI transformation or
mechanical-edit worker with supplied inputs, a clear expected output, and
deterministic acceptance criteria. Examples include bounded reformatting,
structured-to-structured transformation, fixture generation, and mechanical
source edits. It is not a general low-cost routing tier.

Keep the deterministic-first boundary intact: retrieval, metadata, identity,
inventory collection, calculation, test execution, validation, provenance,
state, and rendering remain deterministic code, tools, or data. Spark may
transform an authoritative mechanical snapshot, but must never retrieve or
overwrite the authoritative mechanical data and must never replace tool-run
tests or validation.

Do not assign Spark-eligible status to architecture, contracts,
authentication, security, privacy, migrations, ambiguous debugging,
integration or conflict resolution, release or acceptance work, or a final
verdict. Route those scopes under their ordinary capability and reasoning
requirements.

For a composer-derived worker, use the composition and launch tooling when it
is available, but do not require a quarantine handshake for a normal native
worker. Direct native workers are normal workers: give them the assigned scope,
isolation, acceptance criteria, and proportionate validation. An explicit
model ID or raw reasoning effort is a requested configuration, not a receipt
that the runtime selected or honored it.

The currently supported conservative Spark fallback is `gpt-5.6-terra` with
`low` reasoning only when the composer state is exactly
`unknown_or_unexposed` and `availability_evidence` is `Unverified`.
`authoritatively_unavailable` and `separate_pool_exhausted` are reserved state
names and fail closed at launch until a supported host capability receipt
provides authoritative availability evidence. An unverified claim of either
reserved state is not permission to launch Terra. Never move the work to Seat
`0`; block only the affected launch and continue the project through another
safe supported path. Report actual model and reasoning as `Unverified` unless
authoritative runtime selection metadata attests them.

On a hook-covered path, a missing, altered, or non-matching composer request
is inadmissible for that Spark launch. On an unhooked path, do not claim that
this routing is enforced; request the explicit Spark assignment or the
supported `unknown_or_unexposed` Terra fallback and continue the project under
unchanged worker boundaries. Neither path converts a requested model or
reasoning effort into an actual-runtime claim.

For explicit per-seat selection, record the exact model ID and reasoning as
requested configuration, not runtime attestation; otherwise record no explicit
request. Before a material request, record seat, objective, fit, and applicable
weaker/stronger justification.

If family selection is unavailable, say so and optimize decomposition with the
lowest suitable model; separately report unavailable reasoning and imply none.

Use the Model Routing Gate only after a runtime-specific negative canary proves
direct launch and output collection traverse its `PreToolUse` and `PostToolUse`
hooks; then it may enforce that covered request. Native collaboration
interception is capability-dependent. A denied canary is evidence this path is
hook-covered; a started canary is telemetry that this path is not hook-gated,
not a universal expectation for every host. On an unhooked path, normal workers
may still proceed with explicit model and reasoning requests, exact scope,
verified mutation isolation, and proportionate validation; report actual model
and reasoning as `Unverified` unless authoritative runtime selection metadata
attests them. `SubagentStart` is neither a launch gate nor binding evidence.

Set `model_critical:false` by default; set it `true` only when validity or
safety depends on attested model identity, never as a task-importance proxy. An
actual-model or actual-reasoning attestation requirement needs authoritative
runtime selection metadata or operator-approved redesign. Block only that
action and continue unrelated work through a normal-worker or native fallback.

Reuse only an accepted, model-compatible seat. Close rejected seats; allow one
assigned relaunch, then block that seat as a runtime-routing defect.

After completion record requested/actual family and reasoning, honored,
fallback, and reason. Actual fields need authoritative runtime, tool, session,
or API metadata; narrative, behavior, style, seat name, plan, or
`SubagentStart` is not evidence, so otherwise report `Unverified`.

Preserve requested reasoning exactly: it is configuration, not runtime proof.
Without authoritative reasoning metadata, set `actual_reasoning_raw` to
`Unverified` and `reasoning_attestation` to `configured_not_runtime_attested`.
A matching model is admissible for an ordinary model-critical seat despite
unverified reasoning; a `reasoning_critical` seat is not.

Record coordinator selection only with authoritative routing or metadata;
predetermined routing is not a defect. Justify material architecture, security,
migration, release, validation, capacity, or implementation-risk changes. The
coordinator owns routing, decomposition, reconciliation, integration, and
final verdict.

## Routing Audit Ledger

Record each observed launch in the local untracked model-routing JSONL ledger:
task/agent IDs, seat, compact objective/rationale, requested model/reasoning,
criticality, lifecycle, authoritative runtime metadata, and evidence source.
Never store prompts, source, subagent output, secrets, or hidden reasoning.

Use `node ~/.codex/policies/bin/acg.mjs model-audit --thread <task-id> --days 14`
to inventory native launches and preserve any authoritative runtime metadata
already available. A transcript can record the requested configuration, but
does not by itself attest actual model or reasoning. Hook events are automatic
only where hooks execute. Missing ledger rows are not proof that no launch
occurred.

For Sol or `xhigh`/stronger assignments, record before launch why cheaper/lower
is insufficient. Audit repeated concentration over a representative window;
one justified security-critical burst does not prove waste.

## Native Diagnostic Compatibility

Some native collaboration paths may bypass plugin `PreToolUse` and
`PostToolUse` hooks. A negative canary proves launch enforcement only when the
unenveloped launch is denied before start; accepting it is telemetry that this
path is not hook-gated. It never stops the project or requires waiting for an
Agent System repair.

`native_quarantine.spawn_request`, `attest-native-model`, and related
quarantine envelopes remain diagnostic compatibility mechanisms for an
existing integration. They are optional, read-only diagnostics; they are not a
normal native-worker admission path, are not required before direct launch,
and must not discard, delay, or quarantine an otherwise authorized normal
worker. Their receipt cannot prove pre-launch interception or bind requested
model/reasoning to actual runtime selection.

If an operator explicitly runs this diagnostic, use its returned material
verbatim and report only the fields that authoritative runtime metadata
attests. Transcript absence, ambiguity, schema drift, missing metadata,
premature attestation, or assignment mismatch leaves actual model and
reasoning `Unverified`; it is a diagnostic result, not a project blocker. Do
not repeat unchanged diagnostic launches or wait for Agent System repair.

`SubagentStart` context cannot stop a seat, cannot establish requested-to-
actual model or reasoning binding, and is not a substitute for an authoritative
runtime selection record.

Native association is not a worktree-ownership receipt. Keep Codex-managed
chat worktrees distinct from Agent-System-owned child worktrees and report that
association as `Unverified` unless the host provides authoritative ownership
metadata. After a hook-definition change, reload the Codex app and review the
`/hooks` trust state before treating hook coverage as current. Those steps do
not prove native interception or actual model/reasoning selection.
