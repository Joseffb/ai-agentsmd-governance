---
name: model-routing-gate
description: Record requested subagent routing and passive lifecycle diagnostics while keeping actual model and reasoning Unverified without separate authoritative runtime evidence.
---

# Model Routing Gate

Use when a task needs explicit requested model/reasoning records or bounded
model-routing diagnostics. It is not a prerequisite for native delegation.

## Before launch

1. Record the seat, objective, requested model, requested raw reasoning, and
   concise rationale when the runtime exposes those controls.
2. Prefer a native custom agent role when stable defaults belong in
   `.codex/agents/<role>.toml`; use direct spawn values for one-off overrides.
3. Set `model_critical:false` unless result validity or safety explicitly
   depends on independently attested model identity.
4. Keep configured values and passive hook-reported model context distinct
   from actual runtime evidence. Do not infer actual model/reasoning from a
   role name, nickname, output quality, timing, or the `SubagentStart`
   lifecycle event.

Composer-derived mechanical assignments may retain their content-addressed
bundle and configured model metadata for offline compatibility diagnostics.
That metadata does not turn the lifecycle hook into runtime attestation or
make quarantine/attestation a normal launch path.

## Runtime evidence

The installed hook observes the official common active-model extension and
event-specific `SubagentStart` fields: `turn_id`, `agent_id`, `agent_type`, and
`permission_mode`. The schema has no reasoning field or requested-to-actual
assignment binding. The hook records the reported model only as passive
non-authoritative context and keeps `Actual model: Unverified`; it never blocks
spawn, follow-up, wait, interrupt, completion, synthesis, or integration.

Normal workers proceed through native collaboration. Block only a
model-critical operation whose validity or safety truly requires separate
authoritative model evidence and for which no safe redesign exists. Continue
unrelated work automatically.

## Reasoning semantics

Preserve the requested raw value exactly. It is configured, not runtime-attested.

Without authoritative runtime reasoning metadata:

```json
{
  "actual_reasoning_raw": "Unverified",
  "reasoning_attestation": "configured_not_runtime_attested"
}
```

Reasoning-critical work requires a separate authoritative runtime evidence
provider or a safe redesign; the lifecycle hook cannot supply that evidence.

## Receipts and limits

Receipts are private, compact, and outside the plugin source tree under `PLUGIN_DATA` or `~/.codex/plugin-data/model-routing-gate`. They exclude prompts and subagent output.

The plugin appends hook-observed lifecycle metadata to `model-routing-events.jsonl` in the same private directory. For a complete task audit, including native paths that bypass hooks, run `node ~/.codex/policies/bin/acg.mjs model-audit --thread <task-id> --days 14`.

Codex hooks are runtime-local diagnostics, not a universal host security
boundary. After installing or updating this plugin, review and trust its hook
through `/hooks`; re-trust the exact definition whenever it changes. Then use
app Reload as the supported refresh action in Codex desktop. If Reload does not refresh the plugin,
mark coverage `Unverified`, continue projects through the permitted fallback,
and leave any restart or diagnostic action to explicit operator choice. Reload
does not retrofit transcript history or prove interception, and creating a
fresh task alone does not reload a process-cached plugin.

## Native path

Use the current runtime's direct native capabilities: spawn a bounded role,
send follow-up work to that same agent, wait for results, and interrupt only
when the active turn should stop. If a capability is unavailable or unsuitable,
automatically choose a safe replacement, rescope, bounded manual prompt, or
project-native tool without expanding authority. Operator reconfirmation is
required only for new authority, a destructive/irreversible decision, or an
actually absent required resource.
