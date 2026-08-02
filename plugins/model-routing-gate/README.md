# Model Routing Gate

A narrow, passive Codex compatibility plugin. The installed hook observes
`SubagentStart` lifecycle metadata and appends bounded private diagnostics. It
does not intercept or gate native spawn, follow-up, wait, interrupt, or
completion.

The official Codex `SubagentStart` schema includes the common active-model
extension plus `turn_id`, `agent_id`, `agent_type`, and `permission_mode`; it
does not expose reasoning or a requested-to-actual assignment binding.
Consequently:

- requested model and reasoning are configuration evidence only;
- the hook-reported model is recorded only as passive, non-authoritative
  context;
- actual model and reasoning remain `Unverified` unless a separate
  authoritative runtime provider supplies them;
- nickname, role, timing, output style, and result quality are never model
  evidence; and
- a missing receipt or hook event never makes normal worker output
  inadmissible.

The repository copy is canonical. Runtime diagnostics are private and
untracked. The ledger defaults to
`~/.codex/plugin-data/model-routing-gate/model-routing-events.jsonl` and
excludes prompts, source, subagent output, secrets, and hidden reasoning.
Legacy envelope parsing and composer-binding code remains available only for
bounded offline diagnostics and compatibility tests; quarantine and native
attestation are not normal launch prerequisites.

## Hook runtime resolution

Every hook invokes the bundled POSIX launcher rather than a bare `node` command. The launcher probes candidates by evaluating `process.versions.node`, accepting only a numeric three-part SemVer on Node 20 or later, and uses the first healthy executable in this fixed order: `MODEL_ROUTING_GATE_NODE` (an explicit plugin-specific override), `$VOLTA_HOME/bin/node`, `$HOME/.volta/bin/node`, `$NVM_BIN/node`, then `node` resolved from `PATH`. It does not change `PATH`, install or configure Node, or modify machine profiles. A broken candidate falls through to the next candidate; if none is healthy, the launcher emits one bounded diagnostic and exits nonzero. Once selected, it `exec`s the hook entrypoint with the original arguments and inherited standard streams.

## Compatibility boundary

Capability detection is per runtime and path. Normal workers proceed through
native collaboration with explicit requested model/reasoning where supported,
exact scope, isolation, and validation. Set `model_critical:false` unless
result validity or safety explicitly depends on independently attested model
identity. If a truly model-critical operation lacks an authoritative evidence
provider, block or redesign only that operation and continue unrelated work.
Do not run a canary, quarantine turn, or attestation handshake as the default.

## Install

Add the plugin to a local marketplace and install it. Review and trust its hook
through `/hooks`; after an update changes the hook definition, review and
re-trust that exact definition. Then use app Reload as the supported refresh
action in Codex desktop. If Reload does not refresh the plugin, mark
coverage `Unverified`, continue projects through the permitted fallback, and
leave any restart or diagnostic action to explicit operator choice. Reload
does not retrofit transcript history or prove hook interception, and starting
a fresh task alone does not reload a process-cached plugin.

## Test

```sh
npm run test:model-routing-gate
```

## Native collaboration

Use the native collaboration capabilities exposed by the current runtime.
Spawn the bounded worker, send follow-up work to the same worker when useful,
wait for results, and interrupt only when its current turn should stop.
Unavailable or unsuitable capabilities are skipped automatically in favor of a
safe replacement, rescope, manual worker prompt, or project-native tool under
unchanged authority. No fallback requires operator reconfirmation unless it
needs new authority, a destructive/irreversible decision, or an actually
missing required resource.
