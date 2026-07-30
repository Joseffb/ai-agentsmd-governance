# Model Routing Policy

Choose the lowest-capability family and lowest reasoning level that can reliably complete and validate the seat. Escalate only for a documented risk or failure mode. Consider complexity, novelty, ambiguity, blast radius, contract sensitivity, security, debugging difficulty, and reasoning-failure cost.

Use standard mode. Never enable, request, or recommend Fast mode for the coordinator or any delegated seat. This does not restrict explicit model-family or reasoning selection.

Bias against `ultra` reasoning. First re-prompt or clarify, narrow or decompose, gather better evidence, and use independent `xhigh` evaluation. Consider `ultra` only if those steps cannot resolve a material blocker. For each use, explain why `xhigh` is insufficient, why the expected correctness benefit outweighs the added token, compute, and cost footprint, and obtain explicit user agreement for that exact incident. Silence, standing authority, or prior agreement does not carry forward.

Families:

- Luna: deterministic documentation, formatting, fixtures, and narrow edits; usually Low or Medium.
- Terra: default feature, test, debugging, migration, integration, and multi-file work; usually Medium or High.
- GPT-5.3-Codex-Spark: mandatory only for composer-derived `mechanical` bounded delegated AI transformation or mechanical-edit work when explicitly selectable from its separate pool. Use the exact runtime ID `gpt-5.3-codex-spark` with `low` reasoning.
- Sol: architecture, authority, distributed systems, difficult concurrency, security-critical design, conflict resolution, and final high-risk verdicts; usually High or stronger when supported. Minimize use without lowering quality.

## Subagent Assignment

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

For a composer-derived worker, the no-guess launch path is exact:
`orchestrate next` -> `orchestrate launch --bundle <path> --seat <N>` -> pass
the returned `native_quarantine.spawn_request` verbatim -> attest -> send the
returned `admitted_assignment.message` verbatim as a new turn. Never construct,
summarize, reformat, or infer either message.

The currently supported conservative Spark fallback is `gpt-5.6-terra` with
`low` reasoning only when the composer state is exactly
`unknown_or_unexposed` and `availability_evidence` is `Unverified`.
`authoritatively_unavailable` and `separate_pool_exhausted` are reserved state
names and fail closed at launch until a supported host capability receipt
provides authoritative availability evidence. An unverified claim of either
reserved state is not permission to launch Terra. Never move the work to Seat
`0`; block only the affected launch and continue the project through another
safe supported path. Report actual model and reasoning as `Unverified` unless
authoritative runtime metadata attests them.

On a hook-covered path, a missing, altered, or non-matching composer request is
inadmissible for that Spark launch. On an unhooked path, do not claim that this
routing is enforced; request the explicit Spark assignment or the supported
`unknown_or_unexposed` Terra fallback and continue the project under unchanged
worker boundaries.

When explicit per-seat selection exists, every new or resumed seat must receive an exact runtime model ID and raw reasoning value. Never use `Inherit current` or silently accept a selectable default. Before launch, record seat, objective, exact requested model and reasoning, fit, why weaker is insufficient when applicable, and why stronger is unnecessary when applicable. Retrospective routing analysis does not correct an inherited launch.

If family selection is unavailable, say so, claim none, and optimize decomposition with the lowest suitable model. Report unavailable reasoning selection separately and imply no level.

Use the Model Routing Gate plugin only after a runtime-specific negative canary proves that direct launch and output collection traverse its `PreToolUse` and `PostToolUse` hooks. When proven, it must block missing or inherited assignments, bind the launch request to the runtime `agent_id`, and reject missing or mismatched evidence. Native collaboration interception is capability-dependent. A negative canary that is denied is evidence that this runtime and path are hook-covered; a canary that starts is evidence that this path is not hook-gated, not a universal expectation for every host. On an unhooked path, normal workers may still proceed with explicit model and reasoning requests, exact scope, verified isolation when mutating, and proportionate validation; report `Actual model: Unverified` unless authoritative runtime metadata attests it. `SubagentStart` model metadata alone may prove the actual model, but not the requested-to-actual binding.

Set `model_critical:false` by default. Set it to `true` only when the result's validity or safety explicitly depends on attested model identity; it is not a proxy for task importance. A mutating model-critical seat that truly requires that attestation must use a hook-covered path or an operator-approved redesign. Block only that attestation-dependent seat and continue unrelated work through the available normal-worker or native fallback path.

Reuse only an accepted, model-compatible seat. Close rejected seats; permit one explicitly assigned relaunch, then block the seat as a runtime-routing defect.

After completion record requested and actual family and reasoning, whether honored, fallback, and reason. Actual model requires authoritative runtime selection response, hook, tool, session, or API metadata. Narrative, behavior, style, seat name, or plan is not evidence; otherwise report it as `Unverified`.

Preserve requested reasoning exactly as submitted. It is the configured assignment, not runtime proof. Until authoritative reasoning metadata exists, set `actual_reasoning_raw` to `Unverified` and `reasoning_attestation` to `configured_not_runtime_attested`. A matching model is admissible for an ordinary model-critical seat despite unverified reasoning; a `reasoning_critical` seat is not.

Record coordinator selection only with authoritative routing or metadata; predetermined coordinator routing is not a defect. Justify changes materially affecting architecture, security, migration, release, validation, capacity, or implementation risk. The coordinator owns routing, decomposition, reconciliation, integration, and final verdict.

## Routing Audit Ledger

Record every observed launch in the local untracked model-routing JSONL ledger. Store task and agent IDs, seat, compact objective and routing rationale, requested model/reasoning, criticality, lifecycle state, actual runtime metadata when authoritative, and evidence source. Never store prompts, source, subagent output, secrets, or hidden reasoning.

Use `node ~/.codex/policies/bin/acg.mjs model-audit --thread <task-id> --days 14` to backfill native launches from authoritative task transcripts and report model/reasoning allocation. Hook events are automatic only where hooks execute; transcript backfill is required for bypassed native paths. Missing ledger rows are not proof that no launch occurred.

For Sol or `xhigh`/stronger assignments, record before launch why a cheaper model or lower reasoning tier is insufficient. A generic statement that the assignment “fits” is not proportionality evidence. Audit repeated concentration over a representative window; do not infer waste from one justified security-critical burst.

## Native Spawn Quarantine

Some native collaboration paths may bypass plugin `PreToolUse` and `PostToolUse` hooks. A negative canary proves launch enforcement only when the unenveloped launch is denied before start; accepting it is telemetry that this path is not hook-gated. It never stops the project or requires waiting for an Agent System repair.

For a read-only model-critical seat on an ungated native path:

1. Prepare the seat with `acg.mjs seat inspect`; pass its returned `native_quarantine.spawn_request` verbatim. It owns `fork_context:false`, the exact `model` and `reasoning_effort`, and the message containing only the one-line `MODEL_ROUTING_GATE_V1` JSON envelope, `MODEL_ROUTING_GATE_QUARANTINE_V1`, and the canonical exact-ready instruction. Never construct or reformat this envelope manually.
2. Do not include the task, repository, worktree, secrets, project data, or mutation authority.
3. Wait for the completed exact `READY_FOR_NATIVE_ATTESTATION` response, then run `node ~/.codex/policies/bin/acg.mjs attest-native-model --parent-thread <id> --agent <runtime-uuid-or-canonical-task-path>`. Premature attestation returns a wait-and-retry disposition; host hooks and chained enforcement remain Unverified.
4. When the receipt says `output_admissible:true`, send `admitted_assignment.message` verbatim as a new turn. Accept only the completion carrying its required final sentinel; an untagged completion is pre-admission, stale, or inadmissible. Otherwise close the seat.

The command binds the parent spawn request, returned agent ID, completed
tool-free quarantine handshake, and authoritative child session metadata.
Transcript absence, ambiguity, schema drift, missing metadata, premature
attestation, or assignment mismatch fails closed.

When a host encrypts or otherwise withholds launch-message transcript content,
native envelope attestation fails closed and provides no current-host admission;
actual model and reasoning remain `Unverified`. Close only that quarantine seat
and continue the project through a permitted native fallback. Do not present
this as host activation, chained-action enforcement, or project blocking.

A marker-only first line, descriptive key/value envelope, changed instruction,
or other multiline rewrite is not equivalent to the canonical envelope and is
rejected with fresh-`seat inspect` remediation. Do not weaken the parser to
infer missing seat, criticality, or attempt evidence.

If native spawn returns no opaque agent ID or the parent transcript contains no
binding, close the quarantine seat, discard its output, and report or local-log
the runtime defect once through the Agent System disposition selected by
consent. Do not repeat quarantine launches or wait for Agent System. The
inadmissible launch remains blocked, but the project immediately continues with
other existing tool definitions or native paths inside current authority. A
failed helper or gateway never grants Seat `0` implementation. Use an
authoritative gateway when available or leave only the model-critical
delegation action blocked.

This is post-launch quarantine attestation, not proof of pre-launch interception. It is permitted only for read-only seats. Mutating model-critical seats remain blocked on an ungated native path. `SubagentStart` context cannot stop a seat and is not a substitute for a pre-launch gate.
