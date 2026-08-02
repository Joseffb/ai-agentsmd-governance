# JIT Orchestration Governor

This source-hook adapter examines `PreToolUse` material action metadata at `tool_input.jit_orchestration` (or `tool_input.orchestration`). It uses the active `~/.codex/policies/lib/orchestration.mjs` classifier when available; otherwise it applies a compatible deterministic fallback.

On `SessionStart` sources `startup`, `resume`, `clear`, and `compact`, it returns one
bounded developer-context refresh: re-resolve the exact project/worktree,
authority, immediate intent, and available native collaboration capabilities;
load applicable `AGENTS.md`; and route only the smallest current policy delta.
The refresh preserves existing context history and is not execution admission
or a persistent workflow.

For every native subagent type, `SubagentStop` checks one stateless completion
line:

```text
AGENT_COMPLETION_CONTRACT_V1 {"status":"complete","artifact":"commit or path","validation":"commands/results","residuals":"remaining risk or none"}
```

A missing or malformed line receives one continuation prompt. If
`stop_hook_active` is already true, the hook records the coverage gap and stops
asking, preventing a continuation loop. No subagent receives a second feedback
pass.

After installing or updating the plugin, review and trust its hooks through
`/hooks`; re-trust each exact hook definition that changed. Then use app Reload
to refresh the plugin. Reload alone does not prove hook activation or retrofit
earlier lifecycle events.

**Seat 0** (`seat_id: "0"`, `"seat-0"`, or `"seat 0"`) is always advisory and fail-open: the hook records a bounded classification or coverage warning but never denies Seat 0 execution. External platform, safety, user-authority, ownership, data, destructive, and release constraints still apply independently of Agent System.

Workers alone fail closed when complete metadata establishes a named expensive or irreversible boundary, including missing project authority or non-canonical metadata that could conceal an authority effect. Ordinary worker strategy, topology, implementation, coding, style, and optimization choices remain observational. The adapter retries its embedded deterministic fallback if the active classifier throws. If both classifiers cannot evaluate an explicitly identified Seat 0 action, it allows the action with an `Unverified` coverage warning; non-Seat-0 and unknown-identity actions continue with `Unverified` guidance. This protects worker boundaries without making Agent System a project dependency or an execution control over Seat 0.

The adapter appends bounded, private local JSONL diagnostic records under plugin data; it never rewrites or truncates prior evidence. Records contain only classification/outcome metadata, never prompts, tool arguments, project data, network reports, authority decisions, KPI feedback, or repairs. Hook activation, host-trusted seat/action binding, and chained-atomic enforcement are **Unverified** runtime limitations until independently demonstrated.
