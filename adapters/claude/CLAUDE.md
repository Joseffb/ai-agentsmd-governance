# AI AGENTS.md Governance: Claude Code Adapter

This file is a thin runtime adapter, not a policy source.

@../../governance/kernel/AGENTS.md
@../../skills/govern-codex-policy/SKILL.md

Follow the imported kernel and loader contract. Load specialist modules only
when the immediate operation triggers them. Invoke the installed Node router at
`~/.codex/policies/bin/acg.mjs`; do not emulate its routing or receipts.

Codex-specific skills, plugins, subagent interception, and model attestations
apply only when the active runtime exposes equivalent capabilities. Report
unsupported runtime enforcement as `Unverified`.
