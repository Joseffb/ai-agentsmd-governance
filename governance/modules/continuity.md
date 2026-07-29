# Continuity Policy

Use project-scoped continuity for significant resumable work, transitions, handoffs, blockers, checkpoints, integration, and completion. It is handoff state, not proof or a replacement for source, Git, docs, trackers, decisions, or releases.

Default to append-only `.codex/project-memory.jsonl` and derived `.codex/PROJECT-STATE.md`; an overlay may substitute an equivalent. Preserve read-only purity: without write authority, return the complete payload.

Record significant events only: `started`, `resumed`, `decision`, `checkpoint`, `paused`, `blocked`, `ready_for_merge`, `merged`, `released`, `completed`, `superseded`, `aborted`. KPI lifecycle event writes are silent private JSONL telemetry. Exclude routine commands, reasoning, secrets, private data, large output, and facts owned elsewhere.

Record versioned ID/time, project/work, status, relevant Git state, objective/reason, material change, actual validation, blockers, open work, next action, references, supersession, and responsible seat. Correct with a new event; keep projections derived.

Before resume, handoff, checkpoint, or completion, reconcile claims against Git, files, trackers, packs, and evidence. Operator handoffs follow BLUF, Pyramid Principle, progressive disclosure, and plain-language design; agent handoffs are token-compressed, meaning-dense, loss-minimizing, and operationally complete. Handoffs state candidate and dirty scope, validation run/omitted, blockers, decisions, references, and safe next action. If the hosting runtime actually rejects further context for capacity, a resulting transition also records closures, receipts, accounting, and the observed host failure. The policy router does not detect runtime exhaustion, and caller-supplied capacity values are not authoritative evidence. Governance estimates alone never require a transition.

Mark a persistent goal `blocked` only after the same genuine blocker lasts at least three consecutive goal turns and no meaningful progress is possible without user input or external-state change. Difficulty, slow or incomplete work, uncertainty, optional clarification, and artificial confirmation are not blockers. A direct user continue or resume restores standing authority and starts a fresh blocker audit; no separate system resume or old blocker count applies.

The coordinator owns canonical writes unless exclusive authority is delegated; subagents normally propose. Never claim state that did not occur.

KPI and after-action reports are operator-requested only; run cleanup never
sends one automatically. On explicit request, generate a bounded report from
the private event ledger with forecast/actual coverage, validation,
seat/operator coverage, interventions, outcome, and system limitations—never
prompts, source, output, secrets, hidden reasoning, or raw task/thread IDs. The
report cannot delay or reopen completion, affect governance, transfer project
ownership, or create a wait-for-Agent-System state.
