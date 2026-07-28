---
name: model-routing-gate
description: Enforce exact per-seat subagent model and reasoning assignments, consume runtime model attestations, and reject inadmissible subagent output.
---

# Model Routing Gate

Use before every new or resumed Codex subagent while this plugin is enabled.

## Before launch

1. Produce the Subagent Assignment Table before any launch.
2. Record seat, objective, exact runtime model ID, exact raw reasoning value, assignment rationale, and the criticality flags.
3. Never use `Inherit current` when explicit model or reasoning selection is available.
4. Prefix the subagent `message` with one line:

```text
MODEL_ROUTING_GATE_V1 {"schema_version":1,"seat_id":"rpc-review","model_critical":true,"reasoning_critical":false,"attempt":1,"objective":"Review RPC output authority","routing_reason":"Security-sensitive bounded adversarial review","weaker_insufficient":"Lower tiers are not reliable enough for cross-boundary authority analysis","stronger_unnecessary":"Ultra is unnecessary because independent xhigh review is sufficient"}
```

5. Pass the same exact model and reasoning through the launch tool's `model` and `reasoning_effort` arguments.
6. Use attempt `2` only after the first launch is rejected. Do not launch a third attempt.

Every governed seat needs an explicit model and reasoning assignment, including non-critical seats. Keep the four audit strings concise and free of secrets or project data. `weaker_insufficient` is required for Sol or `xhigh`/stronger assignments. `model_critical` controls output-admission rigor; it does not authorize inheritance.

## Runtime admission

The hooks bind `PreToolUse.tool_use_id` to `PostToolUse.agent_id`, then compare the requested model with `SubagentStart.model`. Do not use nickname, order, timing, output style, or role names as routing evidence.

Before relying on the gate, run a negative canary that attempts an unenveloped supported-model launch. The canary passes only when `PreToolUse` denies the launch and writes a receipt. A marker-only success is not proof.

On a hook-covered runtime, do not call `wait_agent` until the gate admits the agent. The hook blocks collection when the receipt is missing, pending, rejected, or mismatched. Close rejected agents immediately. Their output is inadmissible for synthesis, implementation, security, continuity, integration, release, or completion.

If native collaboration launch or wait bypasses `PreToolUse` or `PostToolUse`, report the path as technically ungoverned and block model-critical delegation. `SubagentStart.model` may still prove the actual model, but cannot alone prove which requested assignment produced it.

Reuse only a seat with an accepted receipt, the same seat ID, the same exact model, and the same configured reasoning.

## Reasoning semantics

Preserve the requested raw value exactly. It is configured, not runtime-attested.

Without authoritative runtime reasoning metadata:

```json
{
  "actual_reasoning_raw": "Unverified",
  "reasoning_attestation": "configured_not_runtime_attested"
}
```

An ordinary model-critical seat may pass when its model is verified and reasoning remains unverified. A `reasoning_critical` seat must be rejected until authoritative runtime reasoning metadata exists.

## Receipts and limits

Receipts are private, compact, and outside the plugin source tree under `PLUGIN_DATA` or `~/.codex/plugin-data/model-routing-gate`. They exclude prompts and subagent output.

The plugin appends hook-observed lifecycle metadata to `model-routing-events.jsonl` in the same private directory. For a complete task audit, including native paths that bypass hooks, run `node ~/.codex/policies/bin/acg.mjs model-audit --thread <task-id> --days 14`.

Codex hooks are a runtime guardrail, not a universal host security boundary. The gate technically blocks supported `Agent` and `wait_agent` hook paths only after the plugin is installed, enabled, trusted in a new task, and proven by a negative canary. Report unsupported or bypassing runtime paths as ungoverned.

## Ungated Native Path

Use this fallback only for a read-only model-critical seat:

1. Pass the exact `seat inspect` native spawn request. It contains only the assignment envelope, `MODEL_ROUTING_GATE_QUARANTINE_V1`, and the canonical ready instruction.
2. Do not send task, repository, worktree, secrets, project data, or mutation authority.
3. Wait for the completed exact `READY_FOR_NATIVE_ATTESTATION` response, then run `node ~/.codex/policies/bin/acg.mjs attest-native-model --parent-thread <id> --agent <runtime-uuid-or-canonical-task-path>`. A task path must be exact and canonical; nicknames, partial paths, ordering, and output style are not identity evidence.
4. If `output_admissible:true`, send `admitted_assignment.message` verbatim as a new turn and accept only a completion carrying its required final sentinel. Otherwise close the seat.

Do not use native quarantine for mutating model-critical seats. Missing or
changed transcript metadata blocks the seat. Native attestation is post-launch
evidence only; it does not prove host activation, pre-launch interception,
chained-action enforcement, or actual reasoning identity.

If a host encrypts or otherwise withholds launch-message transcript content,
native envelope attestation fails closed. It provides no current-host admission,
and actual model/reasoning remain Unverified. Close only the quarantine seat and
continue the project through a permitted native fallback; do not treat this as
project blocking or proof of host activation or chained-action enforcement.
