# Model Routing Gate

A narrow Codex plugin that, on hook-covered subagent paths:

- rejects inherited, missing, or unsupported per-seat assignments;
- binds optional composer-derived assignment and Spark-eligibility metadata to launch receipts;
- records requested model and raw reasoning before launch;
- correlates `tool_use_id` with runtime `agent_id`;
- verifies the actual model from `SubagentStart`;
- preserves unverified reasoning honestly;
- blocks collection of inadmissible subagent output;
- appends compact launch lifecycle metadata to a private JSONL ledger;
- permits one governed relaunch after rejection.

The repository copy is canonical. Runtime receipts are private and untracked.

The ledger defaults to `~/.codex/plugin-data/model-routing-gate/model-routing-events.jsonl`. It excludes prompts, source, subagent output, secrets, and hidden reasoning. Use the governance CLI's `model-audit` command to backfill native launches that bypass hooks and summarize a task or time window.

Composer v6 Spark and Terra/low mechanical launches require the exact
`composer_assignment` emitted with the launch. The gate reads its owner-private
`bundle_path` beneath `ACG_ORCHESTRATION_BUNDLE_ROOT` (defaulting to the
private Codex orchestration store), recomputes the bounded v6 bundle's
canonical digest, and verifies its execution, correlation, and causation IDs
against both the bundle and selected worker prompt before checking the worker
seat, assignment IDs, prompt-envelope digest, model/reasoning, and complete
Spark gate. Unknown or self-authored identity fields fail closed. Selectable
work requires exact Spark/low. With `availability_evidence:"Unverified"`, only
`unknown_or_unexposed` may use conservative Terra/low; unavailable or exhausted
claims require a future supported host receipt and currently fail closed.
Receipts exclude the private bundle path and retain only bounded binding
metadata. Legacy ordinary non-Spark envelopes remain supported. Hook
interception and actual routing remain `Unverified` without runtime evidence.

## Hook runtime resolution

Every hook invokes the bundled POSIX launcher rather than a bare `node` command. The launcher probes candidates by evaluating `process.versions.node`, accepting only a numeric three-part SemVer on Node 20 or later, and uses the first healthy executable in this fixed order: `MODEL_ROUTING_GATE_NODE` (an explicit plugin-specific override), `$VOLTA_HOME/bin/node`, `$HOME/.volta/bin/node`, `$NVM_BIN/node`, then `node` resolved from `PATH`. It does not change `PATH`, install or configure Node, or modify machine profiles. A broken candidate falls through to the next candidate; if none is healthy, the launcher emits one bounded diagnostic and exits nonzero. Once selected, it `exec`s the hook entrypoint with the original arguments and inherited standard streams.

## Compatibility boundary

Native collaboration interception is capability-dependent: some Codex paths bypass local-function `PreToolUse` and `PostToolUse` while still emitting `SubagentStart`. On an unhooked path the plugin cannot prove the requested-to-actual binding or technically block output. A failed negative canary is telemetry for that runtime/path, never a project stop and not a claim that every host bypasses hooks. Normal workers may proceed with explicit model/reasoning requests, exact scope, isolation, and validation; report actual routing as `Unverified` without authoritative metadata. Reserve `model_critical:true` for work whose result validity or safety explicitly depends on attested model identity; it defaults to `false`. A mutating model-critical seat that truly needs attestation must use a hook-covered path or an operator-approved redesign, while unrelated work continues.

## Install

Add the plugin to a local marketplace, install it, and trust its hooks through `/hooks`. After installing or updating it in Codex desktop, use app Reload as the supported refresh action. Create a new top-level proof task only when launch-time enforcement needs proof. If Reload does not refresh the plugin, mark enforcement `Unverified`, continue projects through the permitted fallback, and leave any restart or diagnostic action to explicit operator choice. Reload does not retrofit transcript history or prove hook interception, and starting a fresh task alone does not reload a process-cached plugin.

## Test

```sh
npm run test:model-routing-gate
```

## Native collaboration fallback

If the negative canary is accepted, the native path is not hook-gated. Use the governance CLI's read-only quarantine flow instead:

1. Pass the exact `seat inspect` native spawn request with explicit model/reasoning and its canonical quarantine-ready instruction.
2. Wait for the completed exact `READY_FOR_NATIVE_ATTESTATION` response, then run `node ~/.codex/policies/bin/acg.mjs attest-native-model --parent-thread <id> --agent <runtime-uuid-or-canonical-task-path>`. A task-path selector must be exact and canonical; nicknames, partial paths, ordering, and output style are not identity evidence.
3. Deliver `admitted_assignment.message` as a new turn only when `output_admissible` is `true`, and accept only a completion carrying its required final sentinel; otherwise close the seat.

This binds native parent and child session metadata after launch. It does not
prove host activation, pre-launch interception, chained-action enforcement, or
actual reasoning identity, so it is not allowed for mutating model-critical
seats.

If a host encrypts or otherwise withholds launch-message transcript content,
native envelope attestation fails closed: it creates no current-host admission,
and actual model/reasoning remain Unverified. Close only that quarantine seat
and continue the project through a permitted native fallback; this does not
block the project or prove host activation or chained-action enforcement.
