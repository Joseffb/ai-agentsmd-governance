# JIT Orchestration Governor

This source-hook adapter examines `PreToolUse` material action metadata at `tool_input.jit_orchestration` (or `tool_input.orchestration`). It uses the active `~/.codex/policies/lib/orchestration.mjs` classifier when available; otherwise it applies a compatible deterministic fallback.

It denies only the immediate action when complete metadata proves that **Seat 0** (`seat_id: "0"`, `"seat-0"`, or `"seat 0"`) is undertaking `worker_required` work, or when any seat's immediate action is `project_authority_required`. The latter returns explicit user-authority guidance. Unknown, aliased, or case-variant effects deny only their immediate action for every seat until complete canonical metadata is supplied; a worker cannot relabel an authority effect to bypass the boundary.

The adapter retries its embedded deterministic fallback if the active classifier throws. If both classifiers cannot evaluate an explicitly identified Seat 0 action, it denies only that action and directs native delegation or complete metadata; non-Seat-0 and unknown-identity actions continue with `Unverified` guidance. This protects orchestration boundaries without making Agent System a project dependency.

The adapter appends bounded, private local JSONL diagnostic records under plugin data; it never rewrites or truncates prior evidence. Records contain only classification/outcome metadata, never prompts, tool arguments, project data, network reports, authority decisions, KPI feedback, or repairs. Hook activation, host-trusted seat/action binding, and chained-atomic enforcement are **Unverified** runtime limitations until independently demonstrated.
