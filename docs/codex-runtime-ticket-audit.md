# Codex Runtime Ticket Audit

Status: public-safe local audit; no ticket was created or updated.

## Scope and evidence boundary

This audit examined an ignored local issue ledger only to aggregate failure
classes and counts, plus the currently installed local application evidence.
The private feedback identifier, private task identifiers, local paths, names,
and issue contents are intentionally excluded. No new canary was run.

The local evidence contains multiple runtime, workflow, environment-binding,
and validation-tooling failure classes. It supports mitigation work in this
repository, but does not establish that a host runtime has accepted, assigned,
or resolved an external ticket. Current external ticket status is **ticket
status unknown**.

## Public-safe disposition

| Failure class family | Disposition | Evidence boundary |
| --- | --- | --- |
| Runtime enforcement and host integration | `runtime_limited` | Local application behavior is not authoritative host-interception proof; ordinary direct native workers remain available without a local gate. |
| Local hook coverage | `mitigated` / `runtime_limited` | Official documentation supports `PreToolUse` matching local function tools, including `spawn_agent` via the `Agent` alias; specialized tool paths can opt out. |
| Subagent lifecycle hooks | `runtime_limited` | `SubagentStart` can add passive context but `continue: false` does not deny a subagent launch; it cannot attest requested-to-actual model or reasoning binding. |
| Native worktree ownership | `unverifiable` | Codex-managed chat worktrees and Agent-System-owned child worktrees are distinct ownership models; native association is not an ownership receipt. |
| App-server telemetry and collaboration | `mitigated` | Official app-server documentation exposes thread usage updates, account usage reads, per-turn token categories, and collaboration items that can carry `newThreadId`; local use remains separately evidenced. |
| Screenshot, profile, and label symptoms | `ticket_status_unknown` | The reviewed current app 26.727 changelog does not claim fixes for these symptoms. Absence of a changelog claim is not proof of an unresolved defect. |
| Local workflow validation | `mitigated` | Repository checks can demonstrate bounded local behavior only. |
| Environment and root binding | `open` | Local issue recurrence does not determine host ticket status. |
| Regression | `unverifiable` | No approved reproduction was run for this audit. |
| External feedback ticket | `ticket_status_unknown` | No public authoritative ticket state was available. |

The applicable public classifications are: `solved`, `mitigated`, `open`,
`regression`, `unverifiable`, `runtime_limited`, and `ticket_status_unknown`.
This audit does not claim `solved` for a host-runtime capability without
authoritative runtime evidence.

## External product references

OpenAI's official [Codex hooks manual](https://learn.chatgpt.com/docs/hooks.md)
documents `PreToolUse` coverage for local function tools (with `spawn_agent`
matching `Agent`), the non-denying `SubagentStart` boundary, and specialized
tool-path opt-outs. Direct native workers therefore remain normal workers;
explicit model and reasoning values are requested configuration, and actual
values remain `Unverified` without authoritative runtime selection metadata.
Codex-managed chat worktrees are distinct from Agent-System-owned child
worktrees; a native association remains `Unverified` unless the host provides
an authoritative ownership receipt. The official [Codex App Server manual](https://learn.chatgpt.com/docs/app-server.md)
documents `thread/tokenUsage/updated`, `account/usage/read`, per-turn input,
cached-input, output, and reasoning token usage, and collaboration items with
an optional `newThreadId`. The current app 26.727 changelog review contains no
claim that screenshot, profile, or label symptoms were fixed. This repository
does not treat local observations or changelog silence as product-release
evidence.

## Follow-up rule

Only a future, approved, bounded reproduction with authoritative host metadata
may change a host-runtime classification. It must update private evidence first
and must not disclose private identifiers or contents in a tracked artifact.
After a hook-definition change, reload the Codex app and review `/hooks` trust
state before treating hook coverage as current; neither step proves native
interception or changes a ticket classification.
