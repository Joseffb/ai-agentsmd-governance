# Model Routing Gate

A narrow Codex plugin that, on hook-covered subagent paths:

- rejects inherited, missing, or unsupported per-seat assignments;
- records requested model and raw reasoning before launch;
- correlates `tool_use_id` with runtime `agent_id`;
- verifies the actual model from `SubagentStart`;
- preserves unverified reasoning honestly;
- blocks collection of inadmissible subagent output;
- appends compact launch lifecycle metadata to a private JSONL ledger;
- permits one governed relaunch after rejection.

The repository copy is canonical. Runtime receipts are private and untracked.

The ledger defaults to `~/.codex/plugin-data/model-routing-gate/model-routing-events.jsonl`. It excludes prompts, source, subagent output, secrets, and hidden reasoning. Use the governance CLI's `model-audit` command to backfill native launches that bypass hooks and summarize a task or time window.

## Compatibility boundary

Some Codex collaboration paths bypass local-function `PreToolUse` and `PostToolUse` hooks while still emitting `SubagentStart`. On those paths the plugin can observe the actual model but cannot prove the requested-to-actual binding or technically block output. Treat model-critical delegation as inadmissible until a negative canary proves interception for the active runtime.

## Install

Add the plugin to a local marketplace, install it, trust its hooks through `/hooks`, and start a new task. Plugin hooks do not retrofit an already-running task.

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
